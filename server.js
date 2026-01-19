const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const mongoose = require('mongoose');

const app = express().use(bodyParser.json());

// --- 1. REMPLACER CANNOT GET / PAR UNE PAGE D'ACCUEIL ---
app.get('/', (req, res) => {
    res.send(`
        <html>
            <head><title>ProxyFlow Bot Status</title></head>
            <body style="font-family: sans-serif; text-align: center; padding-top: 50px; background: #121212; color: white;">
                <h1>🤖 ProxyFlow Bot is Online</h1>
                <p>Status: <span style="color: #2ecc71;">Active</span></p>
                <hr style="width: 200px; border: 0.5px solid #333;">
                <p style="font-size: 0.8em; color: #888;">© 2026 ProxyFlow Services</p>
            </body>
        </html>
    `);
});

// --- CONFIGURATION ---
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const MONGO_URI = process.env.MONGO_URI;

mongoose.connect(MONGO_URI).then(() => console.log("✅ Bot ProxyFlow Connecté"));

// --- MODÈLES ---
const User = mongoose.model('User', new mongoose.Schema({
    psid: { type: String, unique: true },
    email: String, password: String,
    balance: { type: Number, default: 0 },
    isLoggedIn: { type: Boolean, default: false },
    step: { type: String, default: 'IDLE' }
}));

const Order = mongoose.model('Order', new mongoose.Schema({
    psid: String, orderId: String, method: String, provider: String,
    price: Number, status: { type: String, default: 'EN ATTENTE' },
    paymentRef: String, proxyData: String, expiresAt: Date, date: { type: Date, default: Date.now }
}));

// --- WEBHOOK ---
app.get('/webhook', (req, res) => {
    if (req.query['hub.verify_token'] === 'tata') res.status(200).send(req.query['hub.challenge']);
});

app.post('/webhook', async (req, res) => {
    let body = req.body;
    if (body.object === 'page') {
        for (const entry of body.entry) {
            let event = entry.messaging[0];
            let psid = event.sender.id;
            let user = await User.findOne({ psid }) || await User.create({ psid });
            if (event.message && event.message.text) handleMessage(psid, event.message.text, user);
            else if (event.postback) handlePostback(psid, event.postback.payload, user);
        }
        res.status(200).send('EVENT_RECEIVED');
    }
});

// --- LOGIQUE TEXTE & BOUTONS ---
async function handleMessage(psid, text, user) {
    if (user.step === 'SIGNUP_EMAIL') { user.email = text; user.step = 'SIGNUP_PASS'; await user.save(); return sendText(psid, "🔐 Choose a password:"); }
    if (user.step === 'SIGNUP_PASS') { user.password = text; user.isLoggedIn = true; user.step = 'IDLE'; await user.save(); return sendMenu(psid, user); }
    if (user.step === 'LOGIN_EMAIL') { user.email = text; user.step = 'LOGIN_PASS'; await user.save(); return sendText(psid, "🔑 Password:"); }
    if (user.step === 'LOGIN_PASS') {
        const acc = await User.findOne({ email: user.email, password: text });
        if (acc) { user.isLoggedIn = true; user.step = 'IDLE'; await user.save(); return sendMenu(psid, user); }
        return sendText(psid, "❌ Wrong password.");
    }
    if (user.step === 'AWAITING_PAYMENT_ID') {
        const lastOrder = await Order.findOne({ psid }).sort({ date: -1 });
        if (lastOrder) { lastOrder.paymentRef = text; await lastOrder.save(); }
        user.step = 'IDLE'; await user.save();
        return sendText(psid, "✅ Payment ID received! An admin will verify it soon.");
    }
    if (!user.isLoggedIn) return sendAuth(psid);
    sendMenu(psid, user);
}

async function handlePostback(psid, payload, user) {
    if (payload === 'GOTO_SIGNUP') { user.step = 'SIGNUP_EMAIL'; await user.save(); return sendText(psid, "📧 Enter your Email:"); }
    if (payload === 'GOTO_LOGIN') { user.step = 'LOGIN_EMAIL'; await user.save(); return sendText(psid, "📧 Enter your Email:"); }
    if (!user.isLoggedIn) return sendAuth(psid);

    if (payload === 'MY_ACCOUNT') {
        return sendButtons(psid, `👤 ${user.email}\n💰 Balance: ${user.balance.toFixed(2)}$`, [
            { "title": "📡 My Proxies", "payload": "MY_PROXIES" },
            { "title": "➕ Add Funds", "payload": "ADD_FUNDS" },
            { "title": "📜 History", "payload": "MY_ORDERS" }
        ]);
    }

    if (payload === 'MY_ORDERS') {
        const orders = await Order.find({ psid }).sort({ date: -1 }).limit(8);
        if (orders.length === 0) return sendText(psid, "📜 No orders found.");
        let txt = "📜 Your Last Orders:\n";
        orders.forEach(o => txt += `\nID: ${o.orderId}\n${o.provider} | ${o.status}\nDate: ${o.date.toLocaleDateString()}\n---`);
        return sendText(psid, txt);
    }

    if (payload === 'MY_PROXIES') {
        const active = await Order.find({ psid, status: 'LIVRÉ', expiresAt: { $gt: new Date() } });
        if (active.length === 0) return sendText(psid, "❌ No active proxies.");
        let m = "📡 Your Active Proxies:\n";
        active.forEach(p => m += `\n📍 ${p.provider}\n🔑 ${p.proxyData}\n⏳ Exp: ${Math.ceil((p.expiresAt-new Date())/(1000*3600*24))} days\n---`);
        return sendText(psid, m);
    }

    if (payload === 'ADD_FUNDS') {
        user.step = 'AWAITING_PAYMENT_ID'; await user.save();
        return sendText(psid, "💰 MINIMUM: $4.00\n\nBinance ID: 1192024137\nLTC: ltc1q64ycstakcvdycemj7tj9nexdnc25vv24l4vc8g\n\nSend your Transaction ID here:");
    }

    if (payload === 'START_ORDER') {
        return sendButtons(psid, "🌍 Select Proxy Type:", [
            { "title": "⚡ Static ISP ($5)", "payload": "CAT_STATIC" },
            { "title": "🏠 Virgin Resi", "payload": "CAT_VIRGIN" },
            { "title": "📍 Verizon ($3.5)", "payload": "CAT_VERIZON" }
        ]);
    }

    if (payload === 'CAT_STATIC') {
        return sendButtons(psid, "⚡ Static ISP (Renewable) - $5.0", [
            { "title": "🇺🇸 USA", "payload": "BUY_USA_5.0" },
            { "title": "🇬🇧 UK", "payload": "BUY_UK_5.0" },
            { "title": "🇦🇺 Australia", "payload": "BUY_AUS_5.0" }
        ]);
    }

    if (payload === 'CAT_VIRGIN') {
        return sendButtons(psid, "💎 Virgin Residential - $5.0", [
            { "title": "📶 AT&T (HTTP)", "payload": "BUY_ATT_5.0" },
            { "title": "🌀 Windstream (S5)", "payload": "BUY_WIND_5.0" }
        ]);
    }

    if (payload === 'CAT_VERIZON') {
        return sendButtons(psid, "📍 Verizon Static (Non-renewable) - $3.5", [
            { "title": "VA / WA / NY / IL", "payload": "BUY_VZ_3.5" }
        ]);
    }

    if (payload.startsWith('BUY_')) {
        const [_, item, price] = payload.split('_');
        return sendButtons(psid, `💳 ${item} ($${price})\nPayment Method:`, [
            { "title": `💰 Balance ($${user.balance})`, "payload": `PAY_BAL_${item}_${price}` },
            { "title": "🆔 Binance/LTC", "payload": `PAY_EXT_${item}_${price}` }
        ]);
    }

    if (payload.startsWith('PAY_BAL_')) {
        const [_, __, item, price] = payload.split('_');
        const cost = parseFloat(price);
        if (user.balance >= cost) {
            user.balance -= cost; await user.save();
            const oid = "PF" + Math.floor(Math.random()*99999);
            const exp = new Date(); exp.setDate(exp.getDate() + 30);
            const proxy = `185.12.33.${Math.floor(Math.random()*255)}:8080:user${oid}:pass123`;
            await Order.create({ psid, orderId: oid, method: 'SOLDE', provider: item, price: cost, status: 'LIVRÉ', proxyData: proxy, expiresAt: exp });
            return sendText(psid, `⚡ INSTANT DELIVERY!\n\n🔑 Proxy: ${proxy}\n📅 Exp: ${exp.toLocaleDateString()}`);
        }
        return sendText(psid, `❌ Insufficient balance ($${user.balance}). Need $${cost}.`);
    }

    if (payload.startsWith('PAY_EXT_')) {
        const [_, __, item, price] = payload.split('_');
        const oid = "PF" + Math.floor(Math.random()*99999);
        await Order.create({ psid, orderId: oid, method: 'BINANCE/LTC', provider: item, price: parseFloat(price) });
        user.step = 'AWAITING_PAYMENT_ID'; await user.save();
        return sendText(psid, `🛒 Order ${oid}\n\nPlease send $${price} to Binance ID: 1192024137\n\nThen send your Payment ID here:`);
    }
}

// --- HELPERS ---
function sendAuth(psid) { sendButtons(psid, "Welcome to ProxyFlow 🌐", [{ "title": "Signup", "payload": "GOTO_SIGNUP" }, { "title": "Login", "payload": "GOTO_LOGIN" }]); }
function sendMenu(psid, user) { sendButtons(psid, `Main Menu (Balance: ${user.balance.toFixed(2)}$)`, [{ "title": "🛒 Buy Proxy", "payload": "START_ORDER" }, { "title": "👤 Account", "payload": "MY_ACCOUNT" }]); }
function sendText(psid, text) { callAPI(psid, { text }); }
function sendButtons(psid, text, b) {
    const btns = b.map(x => ({ type: "postback", title: x.title, payload: x.payload }));
    callAPI(psid, { attachment: { type: "template", payload: { template_type: "button", text, buttons: btns } } });
}
function callAPI(psid, message) {
    axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, { recipient: { id: psid }, message }).catch(e => {});
}

// --- 2. SYSTEME UPTIME (AUTO-PING) ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Bot actif sur port ${PORT}`);
    
    // Auto-ping toutes les 10 minutes pour éviter la mise en veille
    setInterval(() => {
        const myUrl = `https://${process.env.RENDER_EXTERNAL_HOSTNAME}/`;
        if (process.env.RENDER_EXTERNAL_HOSTNAME) {
            axios.get(myUrl).then(() => console.log("Self-Ping OK")).catch(() => {});
        }
    }, 600000); 
});
