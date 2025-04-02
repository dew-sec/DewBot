process.env.NODE_OPTIONS = '--no-deprecation'
require('punycode').ucs2 || {}

const punycode = require('punycode/')
require('dotenv').config()

const { Telegraf } = require('telegraf')
const Binance = require('node-binance-api')
const axios = require('axios')

// Tambahkan ini di paling atas file
process.removeAllListeners('warning')

// Cek environment variables
if (!process.env.TELEGRAM_BOT_TOKEN) {
  console.error('❌ TELEGRAM_BOT_TOKEN tidak ada di .env!')
  process.exit(1)
}

if (!process.env.BINANCE_API_KEY || !process.env.BINANCE_API_SECRET) {
  console.error('❌ Binance API keys tidak ada di .env!')
  process.exit(1)
}

// Init Binance dengan environment variables
const binance = new Binance().options({
  APIKEY: process.env.BINANCE_API_KEY,
  APISECRET: process.env.BINANCE_API_SECRET,
  recvWindow: 60000,
  family: 4,
  timeout: 15000,
  urls: {
    base: 'https://api.binance.com/api/',
    stream: 'wss://stream.binance.com:9443/ws'
  },
  verbose: true,
  log: (log) => {
    console.log('📡 Binance API Log:', log)
  }
})

// Config
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
let priceSubscribers = []
let priceTimeout = null
let dailyResetData = {
    lastReset: null,
    btcSnapshot: 0,
    priceSnapshot: 0
}

// Init Bot
const bot = new Telegraf(BOT_TOKEN)

// Helper functions
async function getBTCBalance() {
  try {
    const account = await binance.balance()
    return parseFloat(account.BTC.available)
  } catch (error) {
    console.error('Error ambil saldo:', error)
    return null
  }
}

async function getBTCPrice() {
  try {
    const ticker = await binance.prices('BTCUSDT')
    return parseFloat(ticker.BTCUSDT)
  } catch (error) {
    console.error('Error ambil harga:', error)
    return null
  }
}

// Scheduler reset harian
async function scheduleDailyReset() {
    const now = new Date();
    
    // Set target jam 7 WIB besok
    const target = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
    target.setHours(7, 0, 0, 0);
    if(target <= now) {
        target.setDate(target.getDate() + 1); // Tambah 1 hari jika sudah lewat jam 7
    }

    const timeout = target - now;
    
    console.log('⏳ Next reset at:', target.toLocaleString('id-ID', { 
        timeZone: 'Asia/Jakarta',
        hour12: false 
    }));
    
    setTimeout(async () => {
        console.log('🔁 Memulai proses reset harian...');
        const [btcAmount, price] = await Promise.all([
            getBTCBalance(),
            getBTCPrice()
        ])
        
        if(btcAmount === null || price === null) {
            console.error('Gagal reset harian, coba lagi dalam 5 menit...')
            return setTimeout(scheduleDailyReset, 300000) // Retry in 5 minutes
        }
        
        const previousDayProfit = (dailyResetData.btcSnapshot * price) - 
                                (dailyResetData.btcSnapshot * dailyResetData.priceSnapshot)
        
        dailyResetData = {
            lastReset: new Date().toLocaleString('id-ID', { 
                timeZone: 'Asia/Jakarta',
                hour12: false 
            }),
            btcSnapshot: btcAmount,
            priceSnapshot: price,
            previousProfit: previousDayProfit
        }
        
        const message = `⏰ *Reset Harian 07:00 WIB*\n` +
        `📌 Saldo BTC: \`${btcAmount.toFixed(8)}\`\n` +
        `💰 Harga Reset: \`$${price.toFixed(2)}\`\n` +
        `📈 Profit Hari Ini: \`$${previousDayProfit.toFixed(2)}\``
        
        for(const chatId of priceSubscribers) {
            await bot.telegram.sendMessage(chatId, message)
        }
        
        console.log('✅ Reset harian selesai:', dailyResetData)
        scheduleDailyReset()
    }, timeout);
}

// Command Utama
bot.command('btc', async (ctx) => {
  const price = await getBTCPrice()
  if(!price) return ctx.reply('❌ Gagal ambil harga')
  
  ctx.reply(`💰 *Harga BTC/USDT*: $${price.toFixed(2)}`, { parse_mode: 'Markdown' })
})

bot.command('saldo', async (ctx) => {
  const [btcAmount, price] = await Promise.all([getBTCBalance(), getBTCPrice()])
  
  if(!btcAmount || !price) {
    return ctx.reply('❌ Data tidak tersedia')
  }
  
  const usdValue = btcAmount * price
  const pnlUSD = (btcAmount * price) - (dailyResetData.btcSnapshot * dailyResetData.priceSnapshot)
  const pnlPercent = ((price / dailyResetData.priceSnapshot - 1) * 100).toFixed(2)
  
  ctx.replyWithMarkdown(
    `📊 *Saldo Anda*\n` +
    `🪙 BTC: \`${btcAmount.toFixed(8)}\`\n` +
    `💵 USD: \`$${usdValue.toFixed(2)}\`\n` +
    `📈 *PNL Hari Ini*\n` +
    `🔄 USD: \`${pnlUSD >= 0 ? '+' : '-'}$${Math.abs(pnlUSD).toFixed(2)}\`\n` +
    `📊 Persentase: \`${pnlPercent}%\``
  )
})

bot.command('startprice', async (ctx) => {
  if(!priceSubscribers.includes(ctx.chat.id)) {
    priceSubscribers.push(ctx.chat.id)
    
    const [btcAmount, price] = await Promise.all([getBTCBalance(), getBTCPrice()])
    const usdValue = btcAmount * price
    const pnlUSD = (btcAmount * price) - (dailyResetData.btcSnapshot * dailyResetData.priceSnapshot)
    
    await ctx.replyWithMarkdown(
      `⏰ *Auto Update Per Jam Diaktifkan*\\!\n` +
      `Saldo Awal:\n` +
      `🪙 BTC: \`${btcAmount.toFixed(8)}\`\n` +
      `💵 USD: \`$${usdValue.toFixed(2)}\`\n` +
      `📈 PNL Saat Ini: \`${pnlUSD >= 0 ? '🟢+' : '🔴-'}$${Math.abs(pnlUSD).toFixed(2)}\``
    )
    
    if(!priceTimeout) {
      scheduleHourlyUpdates()
      console.log('⏳ Auto-update per jam dimulai')
    }
  } else {
    ctx.reply('❌ Anda sudah berlangganan update')
  }
})

bot.command('stopprice', (ctx) => {
  priceSubscribers = priceSubscribers.filter(id => id !== ctx.chat.id)
  ctx.reply('🔕 Berhenti update harga')
  
  if(priceSubscribers.length === 0 && priceTimeout) {
    clearTimeout(priceTimeout)
    priceTimeout = null
  }
})

bot.command('pnl', async (ctx) => {
  // Dapatkan data terkini
  const [currentBtc, currentPrice] = await Promise.all([
    getBTCBalance(),
    getBTCPrice()
  ])

  // Validasi data
  if(!currentBtc || !currentPrice || !dailyResetData.priceSnapshot) {
    return ctx.reply('❌ Data belum tersedia, coba lagi nanti')
  }

  // Hitung nilai awal dan sekarang
  const initialValue = dailyResetData.btcSnapshot * dailyResetData.priceSnapshot
  const currentValue = currentBtc * currentPrice
  const pnlUSD = currentValue - initialValue
  const pnlPercent = initialValue !== 0 
    ? ((currentValue / initialValue - 1) * 100).toFixed(2)
    : 'N/A'

  // Format pesan
  const message = 
    `📊 *Profit/Loss Harian* (Sejak ${dailyResetData.lastReset})\n` +
    `├─ 🪙 BTC Awal: \`${dailyResetData.btcSnapshot.toFixed(8)}\`\n` +
    `├─ 💰 Harga Awal: \`$${dailyResetData.priceSnapshot.toFixed(2)}\`\n` +
    `├─ 🪙 BTC Sekarang: \`${currentBtc.toFixed(8)}\`\n` +
    `├─ 💹 Harga Sekarang: \`$${currentPrice.toFixed(2)}\`\n` +
    `├─ 📈 PNL USD: \`${pnlUSD >= 0 ? '🟢+' : '🔴-'}$${Math.abs(pnlUSD).toFixed(2)}\`\n` +
    `└─ 📉 Persentase: \`${pnlUSD >= 0 ? '+' : '-'}${pnlPercent}%\``

  ctx.replyWithMarkdown(message)
})

bot.command('porto', async (ctx) => {
  const [btcAmount, price] = await Promise.all([getBTCBalance(), getBTCPrice()])
  
  if(!btcAmount || !price) {
    return ctx.reply('❌ Gagal ambil data')
  }
  
  const priceChange = ((price / dailyResetData.priceSnapshot - 1) * 100).toFixed(2)
  const usdValue = btcAmount * price
  
  ctx.replyWithMarkdown(
    `📊 *Portfolio Harian*\n` +
    `🕒 Reset Terakhir: \`${dailyResetData.lastReset}\`\n\n` +
    `🪙 *BTC*\n` +
    `Saldo: \`${btcAmount.toFixed(8)}\`\n` +
    `Harga: \`$${price.toFixed(2)}\`\n\n` +
    `💵 *Nilai Total*\n` +
    `USD: \`$${usdValue.toFixed(2)}\`\n\n` +
    `📈 *Perubahan*\n` +
    `Harga: \`${priceChange}%\`\n` +
    `PNL: \`$${(usdValue - (dailyResetData.btcSnapshot * dailyResetData.priceSnapshot)).toFixed(2)}\``
  )
})

bot.command('help', (ctx) => {
  ctx.replyWithMarkdownV2(`
📋 DAFTAR COMMAND \\[v1\\.0\\]

🪙 *Portfolio*
/btc \\- Cek harga BTC terkini
/saldo \\- Lihat saldo BTC & USD
/porto \\- Laporan portfolio harian
/pnl \\- Profit/Loss sejak reset terakhir

⏰ *Auto Update*
/startprice \\- Update harga & saldo per jam \\(00 menit\\)
/stopprice \\- Berhenti update harga

🔄 *Reset & Tools*
/resetnow \\- Paksa reset harian \\(admin\\)
/cekreset \\- Cek data reset terakhir

ℹ️ *Lainnya*
/help \\- Tampilkan menu ini

📌 *Catatan:*
\\- Reset harian otomatis jam 07\\.00 WIB
\\- Data PNL dihitung sejak reset terakhir
\\- Update harga real\\-time dari Binance
  `)
})

// Tambahkan command reset manual (testing)
bot.command('resetnow', async (ctx) => {
  await scheduleDailyReset()
  ctx.reply('🔄 Reset manual berhasil!')
})

// Fungsi Utilitas
async function sendPriceUpdates() {
  try {
    const [btcAmount, price] = await Promise.all([getBTCBalance(), getBTCPrice()])
    if(!btcAmount || !price) return
    
    const usdValue = btcAmount * price
    const pnlUSD = (btcAmount * price) - (dailyResetData.btcSnapshot * dailyResetData.priceSnapshot)
    const pnlPercent = ((price / dailyResetData.priceSnapshot - 1) * 100).toFixed(2)
    
    for(const chatId of priceSubscribers) {
      await bot.telegram.sendMessage(
        chatId,
        `🔄 *Update Real-Time*:\n` +
        `🪙 BTC: \`${btcAmount.toFixed(8)}\`\n` +
        `💰 Harga: \`$${price.toFixed(2)}\`\n` +
        `💵 Nilai: \`$${usdValue.toFixed(2)}\`\n` +
        `📈 PNL Harian: \`${pnlUSD >= 0 ? '🟢+' : '🔴-'}$${Math.abs(pnlUSD).toFixed(2)} (${pnlPercent}%)\``,
        { parse_mode: 'Markdown' }
      )
    }
  } catch(error) {
    console.error('🚨 Error di sendPriceUpdates:', error)
  }
}

// Fungsi scheduler baru
function scheduleHourlyUpdates() {
  const now = new Date()
  const nextHour = new Date(now)
  nextHour.setHours(nextHour.getHours() + 1)
  nextHour.setMinutes(0, 0, 0) // Set ke menit 00
  
  const timeout = nextHour - now
  
  priceTimeout = setTimeout(async () => {
    await sendPriceUpdates()
    scheduleHourlyUpdates() // Jadwalkan lagi untuk jam berikutnya
  }, timeout)
  
  console.log('⏳ Next update at:', nextHour.toLocaleTimeString('id-ID', {
    timeZone: 'Asia/Jakarta',
    hour12: false
  }))
}

// 1. Add keep-alive mechanism at the top
const keepAlive = () => {
  setInterval(() => {
    console.log('❤️  Heartbeat:', new Date().toLocaleTimeString('id-ID', { 
      timeZone: 'Asia/Jakarta',
      hour12: false 
    }))
  }, 30000)
}

// 2. Enhanced main function
async function main() {
  try {
    console.log('🚀 Starting initialization...')
    
    // Test Binance connection first
    console.log('🔌 Testing Binance connection...')
    const binanceTime = await binance.futuresTime()
    console.log('✅ Binance connected | Server Time:', new Date(binanceTime))
    
    // Start Telegram bot
    console.log('🤖 Launching Telegram bot...')
    await bot.launch()
    console.log('✅ Bot active:', (await bot.telegram.getMe()).username)
    
    // Jalankan reset pertama kali
    await scheduleDailyReset()
    // Baru mulai scheduler
    scheduleDailyReset()
    
    // Keep process alive
    console.log('🔄 Starting keep-alive mechanism...')
    keepAlive()
    
    console.log('🌈 Bot fully operational!')
    
  } catch (error) {
    console.error('💥 Critical initialization error:', error)
    process.exit(1)
  }
}

// 3. Global error handling
process.on('uncaughtException', (error) => {
  console.error('🚨 Uncaught Exception:', error)
  // Restart logic can be added here
})

process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️ Unhandled Rejection at:', promise, 'Reason:', reason)
})

// 4. Start the bot
main()
  .then(() => console.log('🎉 Bot startup completed'))
  .catch((err) => console.error('🔥 Failed to start bot:', err))

// Di akhir file sebelum bot.launch()
bot.catch((err, ctx) => {
  console.error('🚨 Global Error:', err)
  ctx.reply('❌ Terjadi kesalahan sistem')
})

bot.command('cekreset', (ctx) => {
  ctx.replyWithMarkdown(
    `🔍 *Data Reset Terakhir:*\n` +
    `⏰ Waktu: \`${dailyResetData.lastReset || 'Belum ada'}\`\n` +
    `🪙 BTC: \`${dailyResetData.btcSnapshot || 0}\`\n` +
    `💰 Harga: \`$${dailyResetData.priceSnapshot || 0}\``
  )
})
