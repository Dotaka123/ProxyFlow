const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const mongoose = require('mongoose');

const app = express().use(bodyParser.json());

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const MONGO_URI = process.env.MONGO_URI;
const SUPPORT_LINK = "https://www.facebook.com/profile.php?id=61586969783401";

mongoose.connect(MONGO_URI);

// --- MODÈLE USER AVEC LANGUE ---
const User = mongoose.model('User', new mongoose.Schema({
    psid: { type: String, unique: true }, 
    email: String, password: String,
    language: { type: String, default: 'en' }, // 'fr' ou 'en'
    balance: { type: Number, default: 0 }, isLoggedIn: { type: Boolean, default: false },
    step: { type: String, default: 'IDLE' }, selectedItem: String, selectedPrice: Number,
    captchaCode: String
}));

const Order = mongoose.model('Order', new mongoose.Schema({
    psid: String, orderId: String, provider: String, price: Number,
    status: { type: String, default: 'PENDING' }, proxyData: String, date: { type: Date, default: Date.now }
}));

const Settings = mongoose.model('Settings', new mongoose.Schema({ key: String, value: String }));

// --- TRADUCTIONS ---
const i18n = {
    auth_msg: { en: "ProxyFlow 🌐\nResidential & ISP Proxies", fr: "ProxyFlow 🌐\nProxies Résidentiels & ISP" },
    login: { en: "🔑 Login", fr: "🔑 Connexion" },
    signup: { en: "📝 Signup", fr: "📝 Inscription" },
    free: { en: "🎁 Free Proxy", fr: "🎁 Proxy Gratuit" },
    shop: { en: "🛒 Shop", fr: "🛒 Boutique" },
    acc: { en: "👤 Account", fr: "👤 Compte" },
    my_proxies: { en: "📜 My Proxies", fr: "📜 Mes Proxies" },
    add_funds: { en: "➕ Add Funds", fr: "➕ Ajouter Fonds" },
    logout: { en: "🚪 Sign Out", fr: "🚪 Déconnexion" },
    back: { en: "Return to main menu", fr: "Retour au menu" }
};

// --- LOGIQUE MESSAGES ---
async function handleMessage(psid, text, user) {
    const lang = user.language;
    if (text.toLowerCase() === "menu" || text === i18n.back[lang]) {
        user.step = 'IDLE'; await user.save();
        return user.isLoggedIn ? sendMenu(psid, user) : sendAuth(psid, user);
    }

    // --- INSCRIPTION / LOGIN (Logique simplifiée pour l'exemple) ---
    if (user.step === 'SIGNUP_EMAIL') {
        user.email = text.trim().toLowerCase();
        user.captchaCode = Math.random().toString(36).substring(2, 7).toUpperCase();
        user.step = 'VERIFY_CAPTCHA'; await user.save();
        return sendText(psid, user, `🤖 CAPTCHA: ${user.captchaCode}`);
    }
    // ... (Reste de la logique de vérification identique au code précédent)
    
    if (user.step === 'ASK_QUANTITY') {
        const qty = parseInt(text);
        if (isNaN(qty) || qty <= 0) return sendText(psid, user, "❌ Error / Erreur");
        const total = qty * user.selectedPrice;
        user.step = 'IDLE'; await user.save();
        const msg = lang === 'fr' ? `🛒 Commande: ${qty}x ${user.selectedItem}\n💰 Total: $${total.toFixed(2)}` : `🛒 Order: ${qty}x ${user.selectedItem}\n💰 Total: $${total.toFixed(2)}`;
        return sendButtons(psid, user, msg, [
            { "title": lang === 'fr' ? "Confirmer & Payer" : "Confirm & Pay", "payload": `CONFIRM_PAY_${qty}_${total}` },
            { "title": "❌ Cancel", "payload": "START_ORDER" }
        ]);
    }

    if (!user.isLoggedIn) return sendAuth(psid, user);
    sendMenu(psid, user);
}

// --- LOGIQUE BOUTONS ---
async function handlePostback(psid, payload, user) {
    // CHOIX DE LA LANGUE INITIAL
    if (payload === 'GET_STARTED' || payload === 'CHANGE_LANG') {
        return sendButtons(psid, user, "Choose your language / Choisissez votre langue :", [
            { "title": "English 🇬🇧", "payload": "SET_LANG_EN" },
            { "title": "Français 🇫🇷", "payload": "SET_LANG_FR" }
        ]);
    }

    if (payload.startsWith('SET_LANG_')) {
        user.language = payload.split('_')[2].toLowerCase();
        await user.save();
        return user.isLoggedIn ? sendMenu(psid, user) : sendAuth(psid, user);
    }

    const lang = user.language;

    if (payload === 'FREE_PROXY') {
        const data = await Settings.findOne({ key: 'free_proxies' });
        return sendText(psid, user, "🎁 PROXY:\n\n" + (data ? data.value : "..."));
    }

    if (!user.isLoggedIn) {
        if (payload === 'GOTO_SIGNUP') { user.step = 'SIGNUP_EMAIL'; await user.save(); return sendText(psid, user, "📧 Email:"); }
        if (payload === 'GOTO_LOGIN') { user.step = 'LOGIN_EMAIL'; await user.save(); return sendText(psid, user, "📧 Email:"); }
        return sendAuth(psid, user);
    }

    // MENU BOUTIQUE
    if (payload === 'START_ORDER') {
        const txt = lang === 'fr' ? "🌍 Sélectionnez une catégorie :" : "🌍 Select Category:";
        return sendButtons(psid, user, txt, [
            { "title": "⚡ Paid Proxies", "payload": "MENU_PAID" },
            { "title": i18n.free[lang], "payload": "FREE_PROXY" }
        ]);
    }

    if (payload === 'MENU_PAID') {
        const info = lang === 'fr' 
            ? "🚀 CATALOGUE PROXYFLOW\n\n• Verizon ($4.5): Top Mobile US (0 Fraud Score).\n• Virgin Resi ($6): Jamais utilisé (0 Fraud Score).\n• Static ISP ($6): Haute vitesse (Peut avoir un score de fraude résiduel)."
            : "🚀 PROXYFLOW CATALOG\n\n• Verizon ($4.5): Top Mobile US (0 Fraud Score).\n• Virgin Resi ($6): Never used (0 Fraud Score).\n• Static ISP ($6): High speed (Might have residual fraud score).";
        
        return sendButtons(psid, user, info, [
            { "title": "Verizon ($4.5)", "payload": "BUY_VERIZON_4.5" },
            { "title": "Virgin Resi ($6)", "payload": "BUY_VIRGIN_6" },
            { "title": "Static ISP ($6)", "payload": "BUY_STATIC_6" }
        ]);
    }

    // MY ACCOUNT & ORDERS
    if (payload === 'MY_ACCOUNT') {
        return sendButtons(psid, user, `👤 ${user.email}\n💰 Bal: $${user.balance.toFixed(2)}`, [
            { "title": i18n.add_funds[lang], "payload": "ADD_FUNDS" },
            { "title": i18n.my_proxies[lang], "payload": "MY_ORDERS" },
            { "title": "🌐 Lang: " + lang.toUpperCase(), "payload": "CHANGE_LANG" }
        ]);
    }

    if (payload === 'MY_ORDERS') {
        const orders = await Order.find({ psid }).sort({ date: -1 }).limit(5);
        let msg = lang === 'fr' ? "📬 Mes Proxies :\n\n" : "📬 My Proxies:\n\n";
        orders.forEach(o => msg += `🆔 ${o.orderId} | ${o.status}\n📦 ${o.provider}\n🔑 ${o.proxyData || '...'}\n---\n`);
        return sendText(psid, user, msg);
    }

    if (payload.startsWith('BUY_')) {
        const [_, item, price] = payload.split('_');
        user.selectedItem = item; user.selectedPrice = parseFloat(price);
        user.step = 'ASK_QUANTITY'; await user.save();
        return sendText(psid, user, lang === 'fr' ? `Combien de proxies ${item} ?` : `How many ${item} proxies?`);
    }

    if (payload.startsWith('CONFIRM_PAY_')) {
        const [,, qty, total] = payload.split('_');
        const cost = parseFloat(total);
        const oid = "PF" + Math.floor(Math.random()*99999);
        if (user.balance >= cost) {
            user.balance -= cost;
            await Order.create({ psid, orderId: oid, provider: `${qty}x ${user.selectedItem}`, price: cost, status: 'PENDING' });
            await user.save();
            return sendText(psid, user, `✅ Order ${oid} OK!`);
        } else {
            await Order.create({ psid, orderId: oid, provider: `${qty}x ${user.selectedItem} (Manual)`, price: cost, status: 'WAITING PAYMENT' });
            const errorTxt = lang === 'fr' ? `💳 PAIEMENT EN ATTENTE\n\nTotal: $${cost.toFixed(2)}\nSolde insuffisant. Payez au support pour valider.` : `💳 WAITING PAYMENT\n\nTotal: $${cost.toFixed(2)}\nLow balance. Pay via support.`;
            return sendButtons(psid, user, errorTxt, [{ "title": "👨‍💻 Support", "url": SUPPORT_LINK }]);
        }
    }
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
    sendButtons(psid, user, `Menu | $${user.balance.toFixed(2)}`, [
        { "title": i18n.shop[l], "payload": "START_ORDER" },
        { "title": i18n.acc[l], "payload": "MY_ACCOUNT" }
    ]);
}

function sendText(psid, user, text) {
    callAPI(psid, { text, quick_replies: [{ content_type: "text", title: i18n.back[user.language], payload: "MAIN" }] });
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
