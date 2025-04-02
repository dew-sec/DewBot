const { Telegraf } = require('telegraf')
const axios = require('axios')

// Config
const BOT_TOKEN = 'API_TOKEN_DARI_BOTFATHER' // Ganti dengan token bot Anda
let btcAmount = 0.00020881

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

// Helper function
async function getBTCPrice() {
    const { data } = await axios.get('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT')
    return parseFloat(data.price)
}

// Jalankan bot
bot.launch()
console.log('🤖 Bot Telegram aktif!') 