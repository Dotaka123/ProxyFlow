const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const mongoose = require('mongoose');

const app = express().use(bodyParser.json());

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const MONGO_URI = process.env.MONGO_URI;
const SUPPORT_LINK = "https://www.facebook.com/profile.php?id=61586969783401";

mongoose.connect(MONGO_URI);

const User = mongoose.model('User', new mongoose.Schema({
    psid: { type: String, unique: true }, 
    email: String, password: String,
    language: { type: String, default: 'NONE' }, // On met NONE par défaut
    balance: { type: Number, default: 0 }, isLoggedIn: { type: Boolean, default: false },
    step: { type: String, default: 'IDLE' }, selectedItem: String, selectedPrice: Number,
    captchaCode: String
}));

const Order = mongoose.model('Order', new mongoose.Schema({
    psid: String, orderId: String, provider: String, price: Number,
    status: { type: String, default: 'PENDING' }, proxyData: String, date: { type: Date, default: Date.now }
}));

const Settings = mongoose.model('Settings', new mongoose.Schema({ key: String, value: String }));

// --- DICTIONNAIRE ---
const i18n = {
    auth_msg: { en: "ProxyFlow 🌐\nResidential & ISP Proxies", fr: "ProxyFlow 🌐\nProxies Résidentiels & ISP", mg: "ProxyFlow 🌐\nFitaovana 'Residential' sy 'ISP Proxies'" },
    login: { en: "🔑 Login", fr: "🔑 Connexion", mg: "🔑 Hiditra" },
    signup: { en: "📝 Signup", fr: "📝 Inscription", mg: "📝 Hisoratra anarana" },
    free: { en: "🎁 Free Proxy", fr: "🎁 Proxy Gratuit", mg: "🎁 'Proxy' maimaimpoana" },
    shop: { en: "🛒 Shop", fr: "🛒 Boutique", mg: "🛒 Tsena" },
    acc: { en: "👤 Account", fr: "👤 Compte", mg: "👤 Kaonty" },
    back: { en: "Return to main menu", fr: "Retour au menu", mg: "Hiverina amin'ny fandraisana" }
};

// --- FONCTION POUR FORCER LE CHOIX DE LANGUE ---
function sendLanguagePicker(psid) {
    const messageData = {
        attachment: {
            type: "template",
            payload: {
                template_type: "button",
                text: "Choose your language / Choisissez votre langue / Safidio ny teninao :",
                buttons: [
                    { type: "postback", title: "English 🇬🇧", payload: "SET_LANG_EN" },
                    { type: "postback", title: "Français 🇫🇷", payload: "SET_LANG_FR" },
                    { type: "postback", title: "Malagasy 🇲🇬", payload: "SET_LANG_MG" }
                ]
            }
        }
    };
    axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, { recipient: { id: psid }, message: messageData });
}

// --- LOGIQUE MESSAGES ---
async function handleMessage(psid, text, user) {
    // SI PAS DE LANGUE : ON FORCE LE CHOIX
    if (user.language === 'NONE') return sendLanguagePicker(psid);

    const lang = user.language;
    if (text.toLowerCase() === "menu" || text === i18n.back[lang]) {
        user.step = 'IDLE'; await user.save();
        return user.isLoggedIn ? sendMenu(psid, user) : sendAuth(psid, user);
    }
    
    // ... (Reste de la logique signup/login/quantity)
    if (!user.isLoggedIn) return sendAuth(psid, user);
    sendMenu(psid, user);
}

// --- LOGIQUE BOUTONS ---
async function handlePostback(psid, payload, user) {
    // Capturer le choix de langue avant tout
    if (payload.startsWith('SET_LANG_')) {
        user.language = payload.split('_')[2].toLowerCase();
        await user.save();
        return user.isLoggedIn ? sendMenu(psid, user) : sendAuth(psid, user);
    }

    // SI TOUJOURS PAS DE LANGUE : ON FORCE LE CHOIX
    if (user.language === 'NONE') return sendLanguagePicker(psid);

    const lang = user.language;

    if (payload === 'CHANGE_LANG') return sendLanguagePicker(psid);

    if (payload === 'MENU_PAID') {
        const info = {
            fr: "🚀 CATALOGUE\n\n• Verizon ($4.5): Top Mobile US (0 Fraud Score).\n• Virgin Resi ($6): Jamais utilisé (0 Fraud Score).\n• Static ISP ($6): Haute vitesse (Peut avoir un 'score de fraude').",
            en: "🚀 CATALOG\n\n• Verizon ($4.5): Top Mobile US (0 Fraud Score).\n• Virgin Resi ($6): Never used (0 Fraud Score).\n• Static ISP ($6): High speed (Might have 'fraud score').",
            mg: "🚀 KATALOGY\n\n• Verizon ($4.5): Mobile US (0 'Fraud Score').\n• Virgin Resi ($6): Mbola tsy nampiasaina (0 'Fraud Score').\n• Static ISP ($6): Mafy be (Mety misy 'fraud score' kely)."
        };
        return sendButtons(psid, user, info[lang], [
            { "title": "Verizon ($4.5)", "payload": "BUY_VERIZON_4.5" },
            { "title": "Virgin Resi ($6)", "payload": "BUY_VIRGIN_6" },
            { "title": "Static ISP ($6)", "payload": "BUY_STATIC_6" }
        ]);
    }

    // ... (Reste de la logique postback)
}

// --- HELPERS ---
function sendAuth(psid, user) {
    const l = user.language;
    sendButtons(psid, user, i18n.auth_msg[l], [
        { "title": i18n.login[l], "payload": "GOTO_LOGIN" },
        { "title": i18n.signup[l], "payload": "GOTO_SIGNUP" },
        { "title": i18n.free[l], "payload": "FREE_PROXY" }
    ]);
}

function sendMenu(psid, user) {
    const l = user.language;
    const txt = l === 'mg' ? `Fandraisana | $${user.balance.toFixed(2)}` : (l === 'fr' ? `Menu | Solde: $${user.balance.toFixed(2)}` : `Menu | Balance: $${user.balance.toFixed(2)}`);
    sendButtons(psid, user, txt, [
        { "title": i18n.shop[l], "payload": "START_ORDER" },
        { "title": i18n.acc[l], "payload": "MY_ACCOUNT" }
    ]);
}

function sendButtons(psid, user, text, b) {
    const btns = b.map(x => x.url ? { type: "web_url", title: x.title, url: x.url } : { type: "postback", title: x.title, payload: x.payload });
    callAPI(psid, {
        attachment: { type: "template", payload: { template_type: "button", text, buttons: btns } },
        quick_replies: [{ content_type: "text", title: i18n.back[user.language], payload: "MAIN" }]
    });
}

function callAPI(psid, message) {
    axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, { recipient: { id: psid }, message }).catch(()=>{});
}

// WEBHOOK
app.post('/webhook', async (req, res) => {
    let entry = req.body.entry[0];
    if (entry && entry.messaging) {
        let event = entry.messaging[0];
        let psid = event.sender.id;
        let user = await User.findOne({ psid });
        if (!user) user = await User.create({ psid, language: 'NONE' }); // Nouvel utilisateur = pas de langue

        if (event.message && event.message.text) handleMessage(psid, event.message.text, user);
        else if (event.postback) handlePostback(psid, event.postback.payload, user);
    }
    res.status(200).send('OK');
});

app.listen(process.env.PORT || 3000);
