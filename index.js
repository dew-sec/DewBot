const { Telegraf } = require('telegraf')
const axios = require('axios')

// Config
const BOT_TOKEN = '7964955582:AAF5shEezUdS-WFqTmvIrXwnk7uHAkx-MWY' // Ganti dengan token bot Anda
let btcAmount = 0.00020881
let priceSubscribers = [] // Array untuk menyimpan chat ID yang berlangganan
let priceInterval = null // Variabel untuk menyimpan interval
let alerts = [] // Array untuk menyimpan alert: { chatId, targetPrice }

// Inisialisasi Bot
const bot = new Telegraf(BOT_TOKEN)

// Command handlers
bot.command('ping', (ctx) => ctx.reply('🏓 Pong!'))
bot.command('btc', async (ctx) => {
    const price = await getBTCPrice()
    ctx.reply(`💰 Harga Bitcoin: $${price.toFixed(2)}`)
})
bot.command('saldo', async (ctx) => {
    const price = await getBTCPrice()
    const usdValue = btcAmount * price
    ctx.reply(`📊 Saldo BTC: ${btcAmount} BTC\n💵 Nilai USDT: ${usdValue.toFixed(2)}`)
})
bot.command('ts', async (ctx) => {
    const [command, amount] = ctx.message.text.split(' ')
    const tambah = parseFloat(amount)
    
    if (!isNaN(tambah) && tambah > 0) {
        btcAmount += tambah
        const price = await getBTCPrice()
        const usdValue = btcAmount * price
        ctx.reply(`✅ Berhasil tambah ${tambah} BTC!\n\nTotal BTC: ${btcAmount.toFixed(8)}\nNilai USDT: ${usdValue.toFixed(2)}`)
    } else {
        ctx.reply('❌ Format salah! Contoh: /ts 0.0001')
    }
})
bot.command('startprice', (ctx) => {
    if (!priceSubscribers.includes(ctx.chat.id)) {
        priceSubscribers.push(ctx.chat.id)
        ctx.reply('🔔 Akan mengirim update harga BTC/USDT setiap 30 detik!\nGunakan /stopprice untuk berhenti')
        
        // Mulai interval jika belum aktif
        if (!priceInterval) {
            priceInterval = setInterval(sendPriceUpdates, 30000)
        }
    } else {
        ctx.reply('❌ Anda sudah berlangganan update harga!')
    }
})
bot.command('stopprice', (ctx) => {
    priceSubscribers = priceSubscribers.filter(id => id !== ctx.chat.id)
    ctx.reply('🔕 Berhenti mengirim update harga')
    
    // Hentikan interval jika tidak ada subscriber
    if (priceSubscribers.length === 0 && priceInterval) {
        clearInterval(priceInterval)
        priceInterval = null
    }
})
bot.command('setalert', (ctx) => {
    const [_, targetPrice] = ctx.message.text.split(' ')
    const price = parseFloat(targetPrice)
    
    if (!isNaN(price) && price > 0) {
        alerts.push({
            chatId: ctx.chat.id,
            targetPrice: price
        })
        ctx.reply(`🔔 Alert aktif! Akan diberitahu ketika harga mencapai $${price.toFixed(2)}`)
    } else {
        ctx.reply('❌ Format salah! Contoh: /setalert 70000')
    }
})
bot.command('myalerts', (ctx) => {
    const userAlerts = alerts.filter(a => a.chatId === ctx.chat.id)
    if (userAlerts.length > 0) {
        const alertList = userAlerts.map(a => `- $${a.targetPrice.toFixed(2)}`).join('\n')
        ctx.reply(`📋 Daftar Alert Anda:\n${alertList}`)
    } else {
        ctx.reply('❌ Anda belum memiliki alert aktif')
    }
})

// Helper function
async function getBTCPrice() {
    const { data } = await axios.get('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT')
    return parseFloat(data.price)
}

// Fungsi untuk mengirim update harga
async function sendPriceUpdates() {
    try {
        const price = await getBTCPrice()
        const usdValue = btcAmount * price
        const message = `🔄 Update Terkini:
💰 BTC/USDT: $${price.toFixed(2)}
📊 Saldo BTC: ${btcAmount.toFixed(8)} BTC
💵 Nilai USDT: ${usdValue.toFixed(2)}`
        
        // Kirim ke semua subscriber
        for (const chatId of priceSubscribers) {
            try {
                await bot.telegram.sendMessage(chatId, message)
            } catch (error) {
                console.error(`Gagal mengirim ke ${chatId}:`, error.message)
                // Hapus subscriber jika terjadi error
                priceSubscribers = priceSubscribers.filter(id => id !== chatId)
            }
        }

        // Cek alert
        const triggeredAlerts = []
        for (const alert of alerts) {
            if (price >= alert.targetPrice) {
                try {
                    await bot.telegram.sendMessage(
                        alert.chatId,
                        `🚨 ALERT TERPENUHI!\nHarga BTC mencapai $${price.toFixed(2)} (Target: $${alert.targetPrice.toFixed(2)})`
                    )
                    triggeredAlerts.push(alert)
                } catch (error) {
                    console.error(`Gagal mengirim alert ke ${alert.chatId}:`, error.message)
                }
            }
        }
        
        // Hapus alert yang sudah terpicu
        alerts = alerts.filter(alert => !triggeredAlerts.includes(alert))

    } catch (error) {
        console.error('Error mendapatkan harga:', error.message)
    }
}

// Update help command
bot.command('help', (ctx) => {
    ctx.replyWithMarkdown(`
    *📚 Daftar Command:*
    /btc - Harga Bitcoin
    /saldo - Cek saldo
    /ts [amount] - Tambah saldo
    /startprice - Auto update harga
    /stopprice - Stop update
    /setalert [price] - Set harga alert
    /myalerts - Lihat daftar alert
    `)
})

// Jalankan bot
bot.launch()
console.log('🤖 Bot Telegram aktif!') 
