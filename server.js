const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const mongoose = require('mongoose');

const app = express().use(bodyParser.json());

app.get('/', (req, res) => {
    res.send(`<body style="background:#121212;color:white;text-align:center;padding-top:100px;font-family:sans-serif;">
        <h1 style="color:#2ecc71;">● ProxyFlow Bot is Online</h1>
    </body>`);
});

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const MONGO_URI = process.env.MONGO_URI;
const SUPPORT_LINK = "https://www.facebook.com/profile.php?id=61586969783401";

mongoose.connect(MONGO_URI);

const User = mongoose.model('User', new mongoose.Schema({
    psid: { type: String, unique: true }, email: String, password: String,
    balance: { type: Number, default: 0 }, isLoggedIn: { type: Boolean, default: false },
    step: { type: String, default: 'IDLE' }, selectedItem: String, selectedPrice: Number,
    captchaCode: String
}));

const Order = mongoose.model('Order', new mongoose.Schema({
    psid: String, orderId: String, provider: String, price: Number,
    status: { type: String, default: 'PENDING' }, proxyData: String, date: { type: Date, default: Date.now }
}));

const Settings = mongoose.model('Settings', new mongoose.Schema({ key: String, value: String }));

// --- LOGIQUE MESSAGES ---
async function handleMessage(psid, text, user) {
    if (text.toLowerCase() === "menu" || text === "Return to main menu") {
        user.step = 'IDLE'; await user.save();
        return user.isLoggedIn ? sendMenu(psid, user) : sendAuth(psid);
    }

    if (user.step === 'SIGNUP_EMAIL') {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(text.trim())) return sendText(psid, "❌ Invalid email:");
        const captcha = Math.random().toString(36).substring(2, 7).toUpperCase();
        user.email = text.trim().toLowerCase();
        user.captchaCode = captcha;
        user.step = 'VERIFY_CAPTCHA'; await user.save();
        return sendText(psid, `🤖 CAPTCHA: Type this code to continue:\n\n👉 ${captcha}`);
    }

    if (user.step === 'VERIFY_CAPTCHA') {
        if (text.trim().toUpperCase() === user.captchaCode) {
            user.step = 'SIGNUP_PASS'; await user.save();
            return sendText(psid, "✅ Correct! Choose a password (min. 6 chars):");
        } else {
            const newC = Math.random().toString(36).substring(2, 7).toUpperCase();
            user.captchaCode = newC; await user.save();
            return sendText(psid, `❌ Wrong code. Try this:\n\n👉 ${newC}`);
        }
    }

    if (user.step === 'SIGNUP_PASS') {
        if (text.length < 6) return sendText(psid, "⚠️ Too short!");
        user.password = text.trim();
        user.isLoggedIn = true; user.step = 'IDLE'; await user.save();
        return sendText(psid, "✅ Account created!");
    }

    if (user.step === 'LOGIN_EMAIL') {
        user.email = text.trim().toLowerCase();
        user.step = 'LOGIN_PASS'; await user.save();
        return sendText(psid, "🔐 Enter password:");
    }

    if (user.step === 'LOGIN_PASS') {
        const real = await User.findOne({ email: user.email });
        if (real && real.password === text.trim()) {
            user.isLoggedIn = true; user.step = 'IDLE'; await user.save();
            return sendMenu(psid, user);
        } else return sendText(psid, "❌ Wrong password.");
    }

    if (user.step === 'ASK_QUANTITY') {
        const qty = parseInt(text);
        if (isNaN(qty) || qty <= 0) return sendText(psid, "❌ Invalid number.");
        const total = qty * user.selectedPrice;
        user.step = 'IDLE'; await user.save();
        return sendButtons(psid, `🛒 Order: ${qty}x ${user.selectedItem}\n💰 Total: $${total.toFixed(2)}`, [
            { "title": "Confirm & Pay", "payload": `CONFIRM_PAY_${qty}_${total}` },
            { "title": "❌ Cancel", "payload": "START_ORDER" }
        ]);
    }

    if (!user.isLoggedIn) return sendAuth(psid);
    sendMenu(psid, user);
}

// --- LOGIQUE BOUTONS ---
async function handlePostback(psid, payload, user) {
    if (payload === 'GET_STARTED' || payload === 'MAIN') {
        user.step = 'IDLE'; await user.save();
        return user.isLoggedIn ? sendMenu(psid, user) : sendAuth(psid);
    }
    if (payload === 'FREE_PROXY') {
        const data = await Settings.findOne({ key: 'free_proxies' });
        return sendText(psid, "🎁 FREE PROXIES:\n\n" + (data ? data.value : "None available."));
    }
    if (payload === 'GOTO_SIGNUP') { user.step = 'SIGNUP_EMAIL'; await user.save(); return sendText(psid, "📧 Enter Email:"); }
    if (payload === 'GOTO_LOGIN') { user.step = 'LOGIN_EMAIL'; await user.save(); return sendText(psid, "📧 Enter Email:"); }

    if (!user.isLoggedIn) return sendAuth(psid);

    if (payload === 'MY_ACCOUNT') {
        return sendButtons(psid, `👤 ${user.email}\n💰 Balance: $${user.balance.toFixed(2)}`, [
            { "title": "➕ Add Funds", "payload": "ADD_FUNDS" },
            { "title": "📜 Mes Proxies", "payload": "MY_ORDERS" },
            { "title": "🚪 Sign Out", "payload": "GOTO_SIGNOUT" }
        ]);
    }

    if (payload === 'MY_ORDERS') {
        const orders = await Order.find({ psid }).sort({ date: -1 }).limit(5);
        if (orders.length === 0) return sendText(psid, "📦 No proxies found.");
        let msg = "📬 Mes Proxies:\n\n";
        orders.forEach(o => msg += `🆔 ${o.orderId} | ${o.status}\n📦 ${o.provider}\n🔑 ${o.proxyData || 'Pending...'}\n---\n`);
        return sendText(psid, msg);
    }

    if (payload === 'ADD_FUNDS') {
        return sendButtons(psid, "💳 HOW TO PAY\n\nMin deposit: $5.00\nMethods: Binance ID or LTC.\n\nSend payment and contact support with proof to update your balance.", [{ "title": "👨‍💻 Support", "url": SUPPORT_LINK }]);
    }

    if (payload === 'START_ORDER') {
        return sendButtons(psid, "🌍 Select Category:", [
            { "title": "⚡ Paid Proxies", "payload": "MENU_PAID" },
            { "title": "🎁 Free Proxy", "payload": "FREE_PROXY" }
        ]);
    }

    // --- INFOS PROXIES AJOUTÉES ICI ---
    if (payload === 'MENU_PAID') {
        return sendButtons(psid, "🚀 RESIDENTIAL (0 FRAUD SCORE)\n\n• Static ISP: High speed, 1-month duration.\n• Virgin Resi: Never used, perfect for social media.\n• Verizon: Top tier US mobile provider.", [
            { "title": "Static ISP ($6)", "payload": "BUY_STATIC_6" },
            { "title": "Virgin Resi ($6)", "payload": "BUY_VIRGIN_6" },
            { "title": "Verizon ($4.5)", "payload": "BUY_VERIZON_4.5" }
        ]);
    }

    if (payload.startsWith('BUY_')) {
        const [_, item, price] = payload.split('_');
        user.selectedItem = item; user.selectedPrice = parseFloat(price);
        user.step = 'ASK_QUANTITY'; await user.save();
        return sendText(psid, `How many ${item} proxies do you want?`);
    }

    if (payload.startsWith('CONFIRM_PAY_')) {
        const [,, qty, total] = payload.split('_');
        const cost = parseFloat(total);
        const oid = "PF" + Math.floor(Math.random()*99999);

        if (user.balance >= cost) {
            user.balance -= cost;
            await Order.create({ psid, orderId: oid, provider: `${qty}x ${user.selectedItem}`, price: cost, status: 'PENDING' });
            await user.save();
            return sendText(psid, `✅ Order ${oid} placed using your balance!`);
        } else {
            await Order.create({ psid, orderId: oid, provider: `${qty}x ${user.selectedItem} (Manual)`, price: cost, status: 'WAITING PAYMENT' });
            return sendButtons(psid, `💳 ORDER PENDING\n\nTotal: $${cost.toFixed(2)}\n\nYou don't have enough balance, but you can pay directly to support via Binance or LTC to get your proxies!`, [
                { "title": "👨‍💻 Pay via Support", "url": SUPPORT_LINK },
                { "title": "🛒 Back to Shop", "payload": "START_ORDER" }
            ]);
        }
    }

    if (payload === 'GOTO_SIGNOUT') { user.isLoggedIn = false; await user.save(); return sendAuth(psid); }
}

function sendAuth(psid) {
    sendButtons(psid, "ProxyFlow 🌐", [
        { "title": "🔑 Login", "payload": "GOTO_LOGIN" },
        { "title": "📝 Signup", "payload": "GOTO_SIGNUP" },
        { "title": "🎁 Free Proxy", "payload": "FREE_PROXY" }
    ]);
}

function sendMenu(psid, user) {
    sendButtons(psid, `Menu | Balance: $${user.balance.toFixed(2)}`, [
        { "title": "🛒 Shop", "payload": "START_ORDER" },
        { "title": "👤 Account", "payload": "MY_ACCOUNT" }
    ]);
}

function sendText(psid, text) {
    callAPI(psid, { text, quick_replies: [{ content_type: "text", title: "Return to main menu", payload: "MAIN" }] });
}

function sendButtons(psid, text, b) {
    const btns = b.map(x => x.url ? { type: "web_url", title: x.title, url: x.url } : { type: "postback", title: x.title, payload: x.payload });
    callAPI(psid, {
        attachment: { type: "template", payload: { template_type: "button", text, buttons: btns } },
        quick_replies: [{ content_type: "text", title: "Return to main menu", payload: "MAIN" }]
    });
}

function callAPI(psid, message) {
    axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, { recipient: { id: psid }, message }).catch(()=>{});
}

app.get('/webhook', (req, res) => { if (req.query['hub.verify_token'] === 'tata') res.status(200).send(req.query['hub.challenge']); });
app.post('/webhook', async (req, res) => {
    let entry = req.body.entry[0];
    if (entry && entry.messaging) {
        let event = entry.messaging[0];
        let psid = event.sender.id;
        let user = await User.findOne({ psid }) || await User.create({ psid });
        if (event.message && event.message.text) handleMessage(psid, event.message.text, user);
        else if (event.postback) handlePostback(psid, event.postback.payload, user);
    }
    res.status(200).send('OK');
});

app.listen(process.env.PORT || 3000);
