const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const mongoose = require('mongoose');

const app = express().use(bodyParser.json());

// UPTIME PAGE
app.get('/', (req, res) => {
    res.send('<body style="background:#121212;color:white;text-align:center;padding-top:50px;font-family:sans-serif;"><h1>🤖 ProxyFlow Bot is Online</h1></body>');
});

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const MONGO_URI = process.env.MONGO_URI;
const SUPPORT_LINK = "https://www.facebook.com/profile.php?id=61586969783401";

mongoose.connect(MONGO_URI);

// --- MODÈLES ---
const User = mongoose.model('User', new mongoose.Schema({
    psid: { type: String, unique: true },
    email: String, password: String,
    balance: { type: Number, default: 0 },
    isLoggedIn: { type: Boolean, default: false },
    step: { type: String, default: 'IDLE' },
    selectedItem: String,
    selectedPrice: Number
}));

const Order = mongoose.model('Order', new mongoose.Schema({
    psid: String, orderId: String, provider: String, price: Number,
    status: { type: String, default: 'EN ATTENTE' }, paymentRef: String, proxyData: String, expiresAt: Date, date: { type: Date, default: Date.now }
}));

// --- LOGIQUE MESSAGES ---
async function handleMessage(psid, text, user) {
    if (user.step === 'SIGNUP_EMAIL') { user.email = text; user.step = 'SIGNUP_PASS'; await user.save(); return sendText(psid, "🔐 Choose a password:"); }
    if (user.step === 'SIGNUP_PASS') { user.password = text; user.isLoggedIn = true; user.step = 'IDLE'; await user.save(); return sendMenu(psid, user); }
    
    // --- GESTION QUANTITÉ ---
    if (user.step === 'ASK_QUANTITY') {
        const qty = parseInt(text);
        if (isNaN(qty) || qty <= 0) return sendText(psid, "❌ Please enter a valid number.");

        if (user.selectedItem === 'VIRGIN' && qty < 10) {
            return sendText(psid, "⚠️ Minimum 10 pieces for Virgin Residential. Please enter 10 or more:");
        }

        const total = qty * user.selectedPrice;
        user.step = 'IDLE';
        await user.save();

        return sendButtons(psid, `🛒 Order: ${qty}x ${user.selectedItem}\n💰 Total: $${total.toFixed(2)}`, [
            { "title": `Pay $${total.toFixed(2)}`, "payload": `CONFIRM_PAY_${qty}_${total}` },
            { "title": "❌ Cancel", "payload": "START_ORDER" }
        ]);
    }

    if (!user.isLoggedIn) return sendAuth(psid);
    sendMenu(psid, user);
}

// --- LOGIQUE BOUTONS ---
async function handlePostback(psid, payload, user) {
    if (payload === 'GOTO_SIGNUP') { user.step = 'SIGNUP_EMAIL'; await user.save(); return sendText(psid, "📧 Enter Email:"); }
    if (!user.isLoggedIn) return sendAuth(psid);

    if (payload === 'START_ORDER') {
        return sendButtons(psid, "🌍 Select Category:", [
            { "title": "⚡ Static ISP ($5)", "payload": "BUY_STATIC_5.0" },
            { "title": "🏠 Virgin Resi ($5)", "payload": "BUY_VIRGIN_5.0" },
            { "title": "📍 Verizon ($3.5)", "payload": "BUY_VERIZON_3.5" }
        ]);
    }

    if (payload.startsWith('BUY_')) {
        const [_, item, price] = payload.split('_');
        user.selectedItem = item;
        user.selectedPrice = parseFloat(price);
        user.step = 'ASK_QUANTITY';
        await user.save();
        
        let msg = `How many ${item} proxies do you want?`;
        if (item === 'VIRGIN') msg += "\n(⚠️ Minimum: 10 pieces)";
        return sendText(psid, msg);
    }

    if (payload.startsWith('CONFIRM_PAY_')) {
        const [,, qty, total] = payload.split('_');
        const cost = parseFloat(total);
        if (user.balance >= cost) {
            user.balance -= cost;
            const oid = "PF" + Math.floor(Math.random()*99999);
            await Order.create({ psid, orderId: oid, provider: `${qty}x ${user.selectedItem}`, price: cost });
            await user.save();
            return sendText(psid, `✅ Order ${oid} placed! Admin will deliver soon.`);
        }
        return sendText(psid, `❌ Insufficient balance ($${user.balance}). Need $${cost}.`);
    }

    if (payload === 'MY_ACCOUNT') {
        return sendButtons(psid, `👤 ${user.email}\n💰 Balance: ${user.balance}$`, [
            { "title": "➕ Add Funds", "payload": "ADD_FUNDS" },
            { "title": "📜 History", "payload": "MY_ORDERS" },
            { "title": "👨‍💻 Support", "url": SUPPORT_LINK }
        ]);
    }
}

// HELPERS
function sendAuth(psid) { sendButtons(psid, "ProxyFlow 🌐", [{ "title": "Signup", "payload": "GOTO_SIGNUP" }]); }
function sendMenu(psid, user) { sendButtons(psid, `Balance: ${user.balance}$`, [{ "title": "🛒 Buy", "payload": "START_ORDER" }, { "title": "👤 Account", "payload": "MY_ACCOUNT" }]); }
function sendText(psid, text) { callAPI(psid, { text }); }
function sendButtons(psid, text, b) {
    const btns = b.map(x => x.url ? { type: "web_url", title: x.title, url: x.url } : { type: "postback", title: x.title, payload: x.payload });
    callAPI(psid, { attachment: { type: "template", payload: { template_type: "button", text, buttons: btns } } });
}
function callAPI(psid, message) { axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, { recipient: { id: psid }, message }).catch(()=>{}); }

// WEBHOOK & LISTEN
app.get('/webhook', (req, res) => { if (req.query['hub.verify_token'] === 'tata') res.status(200).send(req.query['hub.challenge']); });
app.post('/webhook', async (req, res) => {
    let event = req.body.entry[0].messaging[0];
    let psid = event.sender.id;
    let user = await User.findOne({ psid }) || await User.create({ psid });
    if (event.message && event.message.text) handleMessage(psid, event.message.text, user);
    else if (event.postback) handlePostback(psid, event.postback.payload, user);
    res.status(200).send('OK');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    setInterval(() => { if (process.env.RENDER_EXTERNAL_HOSTNAME) axios.get(`https://${process.env.RENDER_EXTERNAL_HOSTNAME}/`).catch(()=>{}); }, 600000);
});
