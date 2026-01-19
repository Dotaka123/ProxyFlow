const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const mongoose = require('mongoose');

const app = express().use(bodyParser.json());
app.get('/', (req, res) => res.send("ProxyFlow Online"));

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const MONGO_URI = process.env.MONGO_URI;
const SUPPORT_LINK = "https://www.facebook.com/profile.php?id=61586969783401";

mongoose.connect(MONGO_URI);

const User = mongoose.model('User', new mongoose.Schema({
    psid: { type: String, unique: true }, 
    email: String, password: String,
    language: { type: String, default: 'NONE' },
    balance: { type: Number, default: 0 }, isLoggedIn: { type: Boolean, default: false },
    step: { type: String, default: 'IDLE' }, selectedItem: String, selectedPrice: Number,
    captchaCode: String
}));

// --- TRADUCTIONS ---
const i18n = {
    welcome: { en: "ProxyFlow 🌐\nResidential & ISP Proxies", fr: "ProxyFlow 🌐\nProxies Résidentiels & ISP", mg: "ProxyFlow 🌐\nFitaovana 'Residential' sy 'ISP Proxies'" },
    login: { en: "🔑 Login", fr: "🔑 Connexion", mg: "🔑 Hiditra" },
    signup: { en: "📝 Signup", fr: "📝 Inscription", mg: "📝 Hisoratra anarana" },
    shop: { en: "🛒 Shop", fr: "🛒 Boutique", mg: "🛒 Tsena" },
    acc: { en: "👤 Account", fr: "👤 Compte", mg: "👤 Kaonty" },
    lang_btn: { en: "🌐 Language", fr: "🌐 Langue", mg: "🌐 Teny" }
};

// --- LOGIQUE MESSAGES ---
async function handleMessage(psid, text, user) {
    // Si l'utilisateur n'a pas de langue, on lui demande avant tout
    if (user.language === 'NONE') return sendLanguagePicker(psid);
    
    const lang = user.language;
    if (text.toLowerCase() === "menu") {
        user.step = 'IDLE'; await user.save();
        return user.isLoggedIn ? sendMenu(psid, user) : sendAuth(psid, user);
    }

    // Inscription + Captcha
    if (user.step === 'SIGNUP_EMAIL') {
        user.email = text.trim().toLowerCase();
        user.captchaCode = Math.random().toString(36).substring(2, 6).toUpperCase();
        user.step = 'VERIFY_CAPTCHA'; await user.save();
        return sendText(psid, `🤖 CAPTCHA : ${user.captchaCode}`);
    }
    if (user.step === 'VERIFY_CAPTCHA') {
        if (text.trim().toUpperCase() === user.captchaCode) {
            user.step = 'SIGNUP_PASS'; await user.save();
            return sendText(psid, lang === 'mg' ? "Tenimiafina (6 farafahakeliny) :" : "Mot de passe (min 6) :");
        }
        return sendText(psid, "❌ Code incorrect / Diso ny code.");
    }
    if (user.step === 'SIGNUP_PASS') {
        if (text.length < 6) return sendText(psid, "⚠️ Trop court !");
        user.password = text.trim(); user.isLoggedIn = true; user.step = 'IDLE'; await user.save();
        return sendMenu(psid, user);
    }

    // Quantité
    if (user.step === 'ASK_QUANTITY') {
        const qty = parseInt(text);
        if (isNaN(qty) || qty <= 0) return sendText(psid, "❌ Error");
        const total = qty * user.selectedPrice;
        user.step = 'IDLE'; await user.save();
        return sendButtons(psid, `Order: ${qty}x ${user.selectedItem}\nTotal: $${total.toFixed(2)}`, [
            { "title": lang === 'mg' ? "Hanamarina" : "Confirmer", "payload": `CONFIRM_PAY_${qty}_${total}` },
            { "title": "❌ Cancel", "payload": "START_ORDER" }
        ]);
    }

    if (!user.isLoggedIn) return sendAuth(psid, user);
    sendMenu(psid, user);
}

// --- LOGIQUE BOUTONS ---
async function handlePostback(psid, payload, user) {
    // Changement de langue PRIORITAIRE (ne doit jamais être bloqué)
    if (payload.startsWith('SET_LANG_')) {
        user.language = payload.split('_')[2].toLowerCase();
        await user.save();
        return user.isLoggedIn ? sendMenu(psid, user) : sendAuth(psid, user);
    }

    if (user.language === 'NONE') return sendLanguagePicker(psid);
    const lang = user.language;

    if (payload === 'GOTO_SIGNUP') { user.step = 'SIGNUP_EMAIL'; await user.save(); return sendText(psid, "📧 Email :"); }
    if (payload === 'GOTO_LOGIN') { user.step = 'LOGIN_EMAIL'; await user.save(); return sendText(psid, "📧 Email :"); }
    if (payload === 'CHANGE_LANG') return sendLanguagePicker(psid);

    if (payload === 'START_ORDER') {
        return sendButtons(psid, "ProxyFlow Shop :", [
            { "title": "Verizon ($4.5)", "payload": "BUY_VERIZON_4.5" },
            { "title": "Virgin Resi ($6)", "payload": "BUY_VIRGIN_6" },
            { "title": "Static ISP ($6)", "payload": "BUY_STATIC_6" }
        ]);
    }

    if (payload.startsWith('BUY_')) {
        const [_, item, price] = payload.split('_');
        user.selectedItem = item; user.selectedPrice = parseFloat(price);
        user.step = 'ASK_QUANTITY'; await user.save();
        return sendText(psid, lang === 'mg' ? "Firy ny tadiavinao ?" : "Quelle quantité ?");
    }

    if (payload === 'MY_ACCOUNT') {
        return sendButtons(psid, `👤 ${user.email}\n💰 $${user.balance.toFixed(2)}`, [
            { "title": i18n.lang_btn[lang], "payload": "CHANGE_LANG" },
            { "title": "👨‍💻 Support", "url": SUPPORT_LINK }
        ]);
    }

    if (payload.startsWith('CONFIRM_PAY_')) {
        const [,, qty, total] = payload.split('_');
        return sendButtons(psid, `Commande : ${qty}x ${user.selectedItem}\nTotal : $${total}\n\nPayez au support pour valider.`, [{ "title": "👨‍💻 Payer / Support", "url": SUPPORT_LINK }]);
    }
}

// --- HELPERS ---
function sendLanguagePicker(psid) {
    sendButtons(psid, "Choose Language / Safidio ny teny :", [
        { "title": "English 🇬🇧", "payload": "SET_LANG_EN" },
        { "title": "Français 🇫🇷", "payload": "SET_LANG_FR" },
        { "title": "Malagasy 🇲🇬", "payload": "SET_LANG_MG" }
    ]);
}

function sendAuth(psid, user) {
    const l = user.language === 'NONE' ? 'fr' : user.language;
    sendButtons(psid, i18n.welcome[l], [
        { "title": i18n.login[l], "payload": "GOTO_LOGIN" },
        { "title": i18n.signup[l], "payload": "GOTO_SIGNUP" }
    ]);
}

function sendMenu(psid, user) {
    const l = user.language;
    sendButtons(psid, `Menu | Solde : $${user.balance.toFixed(2)}`, [
        { "title": i18n.shop[l], "payload": "START_ORDER" },
        { "title": i18n.acc[l], "payload": "MY_ACCOUNT" }
    ]);
}

function sendText(psid, text) {
    callAPI(psid, { text });
}

function sendButtons(psid, text, buttons) {
    const btns = buttons.map(b => b.url ? { type: "web_url", title: b.title, url: b.url } : { type: "postback", title: b.title, payload: b.payload });
    callAPI(psid, { attachment: { type: "template", payload: { template_type: "button", text, buttons: btns } } });
}

function callAPI(psid, message) {
    axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, { recipient: { id: psid }, message }).catch(e => {});
}

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
