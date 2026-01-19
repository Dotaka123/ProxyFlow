const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const mongoose = require('mongoose');

const app = express().use(bodyParser.json());

app.get('/', (req, res) => res.send("ProxyFlow Bot Online"));

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const MONGO_URI = process.env.MONGO_URI;
const SUPPORT_LINK = "https://www.facebook.com/profile.php?id=61550334805446";

mongoose.connect(MONGO_URI);

const User = mongoose.model('User', new mongoose.Schema({
    psid: { type: String, unique: true }, 
    email: String, password: String,
    language: { type: String, default: 'NONE' },
    balance: { type: Number, default: 0 }, isLoggedIn: { type: Boolean, default: false },
    step: { type: String, default: 'IDLE' }, selectedItem: String, selectedPrice: Number,
    captchaCode: String
}));

const Order = mongoose.model('Order', new mongoose.Schema({
    psid: String, orderId: String, provider: String, price: Number,
    status: { type: String, default: 'PENDING' }, proxyData: String, date: { type: Date, default: Date.now }
}));

const Settings = mongoose.model('Settings', new mongoose.Schema({ key: String, value: String }));

const i18n = {
    auth_msg: { en: "ProxyFlow 🌐\nResidential & ISP Proxies", fr: "ProxyFlow 🌐\nProxies Résidentiels & ISP", mg: "ProxyFlow 🌐\nFitaovana 'Residential' sy 'ISP Proxies'" },
    login: { en: "🔑 Login", fr: "🔑 Connexion", mg: "🔑 Hiditra" },
    signup: { en: "📝 Signup", fr: "📝 Inscription", mg: "📝 Hisoratra anarana" },
    free: { en: "🎁 Free Proxy", fr: "🎁 Proxy Gratuit", mg: "🎁 'Proxy' maimaimpoana" },
    shop: { en: "🛒 Shop", fr: "🛒 Boutique", mg: "🛒 Tsena" },
    acc: { en: "👤 Account", fr: "👤 Compte", mg: "👤 Kaonty" },
    my_proxies: { en: "📜 My Proxies", fr: "📜 Mes Proxies", mg: "📜 Ny 'Proxies'-ko" },
    add_funds: { en: "➕ Add Funds", fr: "➕ Ajouter Fonds", mg: "➕ Hampiditra vola" },
    back: { en: "Back", fr: "Retour", mg: "Hiverina" }
};

// --- LOGIQUE MESSAGES ---
async function handleMessage(psid, text, user) {
    if (!user.language || user.language === 'NONE') return sendLanguagePicker(psid);
    const lang = user.language;

    if (text.toLowerCase() === "menu") {
        user.step = 'IDLE'; await user.save();
        return user.isLoggedIn ? sendMenu(psid, user) : sendAuth(psid, user);
    }

    // --- INSCRIPTION AVEC CAPTCHA ---
    if (user.step === 'SIGNUP_EMAIL') {
        user.email = text.trim().toLowerCase();
        user.captchaCode = Math.random().toString(36).substring(2, 7).toUpperCase();
        user.step = 'VERIFY_CAPTCHA'; await user.save();
        return sendText(psid, user, `🤖 CAPTCHA: ${user.captchaCode}`);
    }

    if (user.step === 'VERIFY_CAPTCHA') {
        if (text.trim().toUpperCase() === user.captchaCode) {
            user.step = 'SIGNUP_PASS'; await user.save();
            return sendText(psid, user, lang === 'mg' ? "Safidio ny tenimiafina (6 farafahakeliny):" : "Password (min 6):");
        }
        return sendText(psid, user, "❌ Wrong CAPTCHA. Try again:");
    }

    if (user.step === 'SIGNUP_PASS') {
        if (text.length < 6) return sendText(psid, user, "⚠️ Too short!");
        user.password = text.trim(); user.isLoggedIn = true; user.step = 'IDLE'; await user.save();
        return sendMenu(psid, user);
    }

    // --- CONNEXION ---
    if (user.step === 'LOGIN_EMAIL') {
        user.email = text.trim().toLowerCase();
        user.step = 'LOGIN_PASS'; await user.save();
        return sendText(psid, user, "🔐 Password:");
    }

    if (user.step === 'LOGIN_PASS') {
        const real = await User.findOne({ email: user.email });
        if (real && real.password === text.trim()) {
            user.isLoggedIn = true; user.step = 'IDLE'; await user.save();
            return sendMenu(psid, user);
        }
        return sendText(psid, user, "❌ Login failed.");
    }

    // --- QUANTITÉ ---
    if (user.step === 'ASK_QUANTITY') {
        const qty = parseInt(text);
        if (isNaN(qty) || qty <= 0) return sendText(psid, user, "❌ Error");
        const total = qty * user.selectedPrice;
        user.step = 'IDLE'; await user.save();
        return sendButtons(psid, user, `Order: ${qty}x ${user.selectedItem}\nTotal: $${total.toFixed(2)}`, [
            { "title": lang === 'mg' ? "Hanamarina" : "Confirm", "payload": `CONFIRM_PAY_${qty}_${total}` },
            { "title": "❌ Cancel", "payload": "START_ORDER" }
        ]);
    }

    if (!user.isLoggedIn) return sendAuth(psid, user);
    sendMenu(psid, user);
}

// --- LOGIQUE BOUTONS ---
async function handlePostback(psid, payload, user) {
    if (payload.startsWith('SET_LANG_')) {
        user.language = payload.split('_')[2].toLowerCase();
        await user.save();
        return user.isLoggedIn ? sendMenu(psid, user) : sendAuth(psid, user);
    }

    if (!user.language || user.language === 'NONE') return sendLanguagePicker(psid);
    const lang = user.language;

    if (payload === 'GOTO_SIGNUP') { user.step = 'SIGNUP_EMAIL'; await user.save(); return sendText(psid, user, "📧 Email:"); }
    if (payload === 'GOTO_LOGIN') { user.step = 'LOGIN_EMAIL'; await user.save(); return sendText(psid, user, "📧 Email:"); }
    if (payload === 'CHANGE_LANG') return sendLanguagePicker(psid);

    if (payload === 'START_ORDER') {
        return sendButtons(psid, user, "Category:", [
            { "title": "⚡ Paid Proxies", "payload": "MENU_PAID" },
            { "title": i18n.free[lang], "payload": "FREE_PROXY" }
        ]);
    }

    if (payload === 'MENU_PAID') {
        const info = {
            fr: "🚀 CATALOGUE\n• Verizon ($4.5): 0 Fraud.\n• Virgin Resi ($6): 0 Fraud.\n• Static ISP ($6): High Speed.",
            en: "🚀 CATALOG\n• Verizon ($4.5): 0 Fraud.\n• Virgin Resi ($6): 0 Fraud.\n• Static ISP ($6): High Speed.",
            mg: "🚀 KATALOGY\n• Verizon ($4.5): 0 Fraud.\n• Virgin Resi ($6): 0 Fraud.\n• Static ISP ($6): Mafy be."
        };
        return sendButtons(psid, user, info[lang], [
            { "title": "Verizon ($4.5)", "payload": "BUY_VERIZON_4.5" },
            { "title": "Virgin Resi ($6)", "payload": "BUY_VIRGIN_6" },
            { "title": "Static ISP ($6)", "payload": "BUY_STATIC_6" }
        ]);
    }

    if (payload.startsWith('BUY_')) {
        const [_, item, price] = payload.split('_');
        user.selectedItem = item; user.selectedPrice = parseFloat(price);
        user.step = 'ASK_QUANTITY'; await user.save();
        return sendText(psid, user, "Quantity / Isany?");
    }

    if (payload === 'MY_ACCOUNT') {
        return sendButtons(psid, user, `👤 ${user.email}\n💰 $${user.balance.toFixed(2)}`, [
            { "title": i18n.add_funds[lang], "payload": "ADD_FUNDS" },
            { "title": i18n.my_proxies[lang], "payload": "MY_ORDERS" },
            { "title": "🌐 " + lang.toUpperCase(), "payload": "CHANGE_LANG" }
        ]);
    }

    if (payload.startsWith('CONFIRM_PAY_')) {
        const [,, qty, total] = payload.split('_');
        const cost = parseFloat(total);
        const oid = "PF" + Math.floor(Math.random()*99999);
        await Order.create({ psid, orderId: oid, provider: `${qty}x ${user.selectedItem}`, price: cost, status: 'WAITING PAYMENT' });
        return sendButtons(psid, user, `Order ${oid} Pending.\nTotal: $${cost.toFixed(2)}\nPay via support.`, [{ "title": "👨‍💻 Support", "url": SUPPORT_LINK }]);
    }
}

// --- HELPERS ---
function sendLanguagePicker(psid) {
    callAPI(psid, {
        attachment: { type: "template", payload: {
            template_type: "button", text: "Choose Language / Safidio ny teny:",
            buttons: [
                { type: "postback", title: "English 🇬🇧", payload: "SET_LANG_EN" },
                { type: "postback", title: "Français 🇫🇷", payload: "SET_LANG_FR" },
                { type: "postback", title: "Malagasy 🇲🇬", payload: "SET_LANG_MG" }
            ]
        }}
    });
}

function sendAuth(psid, user) {
    const l = user.language === 'NONE' ? 'en' : user.language;
    sendButtons(psid, user, i18n.auth_msg[l], [
        { "title": i18n.login[l], "payload": "GOTO_LOGIN" },
        { "title": i18n.signup[l], "payload": "GOTO_SIGNUP" }
    ]);
}

function sendMenu(psid, user) {
    const l = user.language;
    sendButtons(psid, user, `Menu | $${user.balance.toFixed(2)}`, [
        { "title": i18n.shop[l], "payload": "START_ORDER" },
        { "title": i18n.acc[l], "payload": "MY_ACCOUNT" }
    ]);
}

function sendText(psid, user, text) {
    callAPI(psid, { text });
}

function sendButtons(psid, user, text, b) {
    const btns = b.map(x => x.url ? { type: "web_url", title: x.title, url: x.url } : { type: "postback", title: x.title, payload: x.payload });
    callAPI(psid, { attachment: { type: "template", payload: { template_type: "button", text, buttons: btns } } });
}

function callAPI(psid, message) {
    axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, { recipient: { id: psid }, message }).catch(e => {});
}

app.get('/webhook', (req, res) => {
    if (req.query['hub.verify_token'] === 'tata') res.status(200).send(req.query['hub.challenge']);
});

app.post('/webhook', async (req, res) => {
    let entry = req.body.entry[0];
    if (entry && entry.messaging) {
        let event = entry.messaging[0];
        let psid = event.sender.id;
        let user = await User.findOne({ psid }) || await User.create({ psid, language: 'NONE' });
        if (event.message && event.message.text) handleMessage(psid, event.message.text, user);
        else if (event.postback) handlePostback(psid, event.postback.payload, user);
    }
    res.status(200).send('OK');
});

app.listen(process.env.PORT || 3000);
