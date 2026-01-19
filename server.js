const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const mongoose = require('mongoose');

const app = express().use(bodyParser.json());

// --- CONFIGURATION ---
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const MONGO_URI = process.env.MONGO_URI;
const SUPPORT_LINK = "https://www.facebook.com/profile.php?id=61586969783401";

// Remplacer "Cannot GET /" par un message de confirmation
app.get('/', (req, res) => {
    res.status(200).send("✅ ProxyFlow Bot Server is Online and Connected.");
});

mongoose.connect(MONGO_URI).then(() => console.log("DB Connected"));

// --- SCHÉMAS ---
const User = mongoose.model('User', new mongoose.Schema({
    psid: { type: String, unique: true }, 
    email: String, password: String,
    language: { type: String, default: 'NONE' },
    isLoggedIn: { type: Boolean, default: false },
    step: { type: String, default: 'IDLE' },
    captchaCode: String, selectedItem: String, selectedPrice: Number
}));

const ProxyStock = mongoose.model('ProxyStock', new mongoose.Schema({
    type: String, data: String, isUsed: { type: Boolean, default: false }
}));

const Order = mongoose.model('Order', new mongoose.Schema({
    psid: String, item: String, qty: Number, price: Number, details: String, status: String, date: { type: Date, default: Date.now }
}));

// --- TRADUCTIONS ---
const i18n = {
    welcome: { en: "ProxyFlow 🌐\nSecure Proxies", fr: "ProxyFlow 🌐\nProxies Sécurisés", mg: "ProxyFlow 🌐\nProxy azo antoka" },
    login: { en: "🔑 Login", fr: "🔑 Connexion", mg: "🔑 Hiditra" },
    signup: { en: "📝 Signup", fr: "📝 Inscription", mg: "📝 Hisoratra anarana" },
    shop: { en: "🛒 Shop", fr: "🛒 Boutique", mg: "🛒 Tsena" },
    acc: { en: "👤 Account", fr: "👤 Compte", mg: "👤 Kaonty" },
    logout: { en: "🔴 Logout", fr: "🔴 Déconnexion", mg: "🔴 Hiala" },
    history: { en: "📜 History", fr: "📜 Historique", mg: "📜 Tantara" }
};

// --- LOGIQUE BOUTONS ---
async function handlePostback(psid, payload, user) {
    if (payload.startsWith('SET_LANG_')) {
        user.language = payload.split('_')[2].toLowerCase();
        await user.save();
        return user.isLoggedIn ? sendMenu(psid, user) : sendAuth(psid, user);
    }

    if (user.language === 'NONE') return sendLanguagePicker(psid);
    const lang = user.language;

    if (payload === 'GOTO_SIGNUP') { user.step = 'SIGNUP_EMAIL'; await user.save(); return sendText(psid, "📧 Email :"); }
    if (payload === 'GOTO_LOGIN') { user.step = 'LOGIN_EMAIL'; await user.save(); return sendText(psid, "📧 Email :"); }
    if (payload === 'LOGOUT') { user.isLoggedIn = false; user.step = 'IDLE'; await user.save(); return sendAuth(psid, user); }

    if (payload === 'START_ORDER') {
        return sendButtons(psid, i18n.shop[lang], [
            { "title": "⚡ Paid Proxies", "payload": "MENU_PAID" },
            { "title": "🎁 Free Proxy", "payload": "GET_FREE" }
        ]);
    }

    if (payload === 'GET_FREE') {
        const proxy = await ProxyStock.findOne({ type: 'Free', isUsed: false });
        if (!proxy) return sendText(psid, "❌ No stock available.");
        proxy.isUsed = true; await proxy.save();
        await Order.create({ psid, item: "Free Proxy", price: 0, details: proxy.data, status: "Delivered" });
        return sendText(psid, `🎁 Your Free Proxy :\n\n${proxy.data}`);
    }

    if (payload === 'MENU_PAID') {
        return sendButtons(psid, "Select Category :", [
            { "title": "Verizon ($4.5)", "payload": "BUY_VERIZON_4.5" },
            { "title": "Virgin ($6)", "payload": "BUY_VIRGIN_6" },
            { "title": "Static ISP ($6)", "payload": "BUY_STATIC_6" }
        ]);
    }

    if (payload.startsWith('BUY_')) {
        const [_, item, price] = payload.split('_');
        user.selectedItem = item; user.selectedPrice = parseFloat(price);
        user.step = 'ASK_QTY'; await user.save();
        return sendText(psid, "Quantity / Quantité ?");
    }

    if (payload === 'MY_ACCOUNT') {
        return sendButtons(psid, `👤 ${user.email}`, [
            { "title": i18n.history[lang], "payload": "VIEW_HISTORY" },
            { "title": i18n.logout[lang], "payload": "LOGOUT" },
            { "title": "🌐 Language", "payload": "CHANGE_LANG" }
        ]);
    }

    if (payload === 'VIEW_HISTORY') {
        const orders = await Order.find({ psid }).sort({ date: -1 }).limit(5);
        if (orders.length === 0) return sendText(psid, "No orders found.");
        let msg = "📜 YOUR HISTORY :\n";
        orders.forEach(o => msg += `\n• ${o.qty || 1}x ${o.item} ($${o.price}) - ${o.status}`);
        return sendText(psid, msg);
    }
    
    if (payload === 'CHANGE_LANG') return sendLanguagePicker(psid);
}

// --- LOGIQUE MESSAGES ---
async function handleMessage(psid, text, user) {
    if (user.language === 'NONE') return sendLanguagePicker(psid);
    const lang = user.language;

    if (text.toLowerCase() === "menu") { user.step = 'IDLE'; await user.save(); return user.isLoggedIn ? sendMenu(psid, user) : sendAuth(psid, user); }

    // Inscription Flow
    if (user.step === 'SIGNUP_EMAIL') {
        user.email = text.trim().toLowerCase();
        user.captchaCode = Math.floor(1000 + Math.random() * 9000).toString();
        user.step = 'VERIFY_CAPTCHA'; await user.save();
        return sendText(psid, `🤖 CAPTCHA : ${user.captchaCode}`);
    }
    if (user.step === 'VERIFY_CAPTCHA') {
        if (text.trim() === user.captchaCode) {
            user.step = 'SIGNUP_PASS'; await user.save();
            return sendText(psid, "Create Password (min 6) :");
        }
        return sendText(psid, "❌ Invalid Captcha. Try again :");
    }
    if (user.step === 'SIGNUP_PASS') {
        if (text.length < 6) return sendText(psid, "Too short. Min 6 chars :");
        user.password = text; user.isLoggedIn = true; user.step = 'IDLE'; await user.save();
        return sendMenu(psid, user);
    }

    // Login Flow
    if (user.step === 'LOGIN_EMAIL') { user.email = text.trim(); user.step = 'LOGIN_PASS'; await user.save(); return sendText(psid, "Enter Password :"); }
    if (user.step === 'LOGIN_PASS') {
        const check = await User.findOne({ email: user.email, password: text.trim() });
        if (check) { user.isLoggedIn = true; user.step = 'IDLE'; await user.save(); return sendMenu(psid, user); }
        return sendText(psid, "❌ Wrong password or email.");
    }

    // Achat Direct
    if (user.step === 'ASK_QTY') {
        const qty = parseInt(text);
        if (isNaN(qty) || qty <= 0) return sendText(psid, "Invalid number.");
        const total = qty * user.selectedPrice;
        await Order.create({ psid, item: user.selectedItem, qty, price: total, status: "Awaiting Payment" });
        user.step = 'IDLE'; await user.save();
        return sendButtons(psid, `Total Price: $${total.toFixed(2)}\n\nContact support to pay and get your IPs.`, [{ "title": "💳 Pay via Support", "url": SUPPORT_LINK }]);
    }

    if (!user.isLoggedIn) return sendAuth(psid, user);
    sendMenu(psid, user);
}

// --- FONCTIONS D'ENVOI ---
function sendLanguagePicker(psid) {
    sendButtons(psid, "Select Language / Safidio ny teny :", [
        { "title": "English 🇬🇧", "payload": "SET_LANG_EN" },
        { "title": "Français 🇫🇷", "payload": "SET_LANG_FR" },
        { "title": "Malagasy 🇲🇬", "payload": "SET_LANG_MG" }
    ]);
}

function sendAuth(psid, user) {
    const l = user.language === 'NONE' ? 'fr' : user.language;
    sendButtons(psid, i18n.welcome[l], [{ "title": i18n.login[l], "payload": "GOTO_LOGIN" }, { "title": i18n.signup[l], "payload": "GOTO_SIGNUP" }]);
}

function sendMenu(psid, user) {
    const l = user.language;
    sendButtons(psid, `ProxyFlow Menu`, [{ "title": i18n.shop[l], "payload": "START_ORDER" }, { "title": i18n.acc[l], "payload": "MY_ACCOUNT" }]);
}

function sendText(psid, text) { callAPI(psid, { text }); }

function sendButtons(psid, text, buttons) {
    const btns = buttons.map(b => b.url ? { type: "web_url", title: b.title, url: b.url } : { type: "postback", title: b.title, payload: b.payload });
    callAPI(psid, { attachment: { type: "template", payload: { template_type: "button", text, buttons: btns } } });
}

function callAPI(psid, message) {
    axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, { recipient: { id: psid }, message }).catch(e => {});
}

// --- WEBHOOK ---
app.get('/webhook', (req, res) => { if (req.query['hub.verify_token'] === 'tata') res.send(req.query['hub.challenge']); });

app.post('/webhook', async (req, res) => {
    const entry = req.body.entry[0];
    if (entry && entry.messaging) {
        const event = entry.messaging[0];
        const psid = event.sender.id;
        let user = await User.findOne({ psid }) || await User.create({ psid });
        if (event.postback) handlePostback(psid, event.postback.payload, user);
        else if (event.message && event.message.text) handleMessage(psid, event.message.text, user);
    }
    res.status(200).send('OK');
});

app.listen(process.env.PORT || 3000);
