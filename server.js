const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const mongoose = require('mongoose');

const app = express().use(bodyParser.json());

// Évite l'erreur "Cannot GET /"
app.get('/', (req, res) => res.send("🚀 ProxyFlow Server is Online"));

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const MONGO_URI = process.env.MONGO_URI;
const SUPPORT_LINK = "https://www.facebook.com/profile.php?id=61586969783401";

mongoose.connect(MONGO_URI);

// --- SCHÉMAS MONGODB (DOIVENT CORRESPONDRE À TON PANEL) ---
const User = mongoose.model('User', new mongoose.Schema({
    psid: { type: String, unique: true }, 
    email: { type: String, default: "" },
    password: { type: String, default: "" },
    language: { type: String, default: 'fr' },
    isLoggedIn: { type: Boolean, default: false },
    step: { type: String, default: 'IDLE' },
    captchaCode: String, selectedItem: String, selectedPrice: Number
}));

// Collection des commandes pour ton Admin Panel
const Order = mongoose.model('Order', new mongoose.Schema({
    psid: String,
    email: String,
    product: String,
    quantity: Number,
    totalPrice: Number,
    status: { type: String, default: 'En attente' },
    createdAt: { type: Date, default: Date.now }
}));

// Collection de tes stocks d'IPs (L'admin remplit ça)
const ProxyStock = mongoose.model('ProxyStock', new mongoose.Schema({
    type: String, // 'Verizon', 'Free', etc.
    data: String, // 'ip:port:user:pass'
    isUsed: { type: Boolean, default: false },
    ownerPsid: { type: String, default: null } // Pour savoir à qui l'IP a été donnée
}));

// --- TRADUCTIONS ---
const i18n = {
    shop: { en: "🛒 Shop", fr: "🛒 Boutique", mg: "🛒 Tsena" },
    acc: { en: "👤 Account", fr: "👤 Compte", mg: "👤 Kaonty" },
    my_proxies: { en: "🔑 My Proxies", fr: "🔑 Mes Proxies", mg: "🔑 Proxy-ko" },
    free: { en: "🎁 Free Proxy", fr: "🎁 Proxy Gratuit", mg: "🎁 Maimaimpoana" },
    logout: { en: "🔴 Logout", fr: "🔴 Déconnexion", mg: "🔴 Hiala" }
};

// --- LOGIQUE BOUTONS (POSTBACK) ---
async function handlePostback(psid, payload, user) {
    const lang = user.language || 'fr';

    if (payload.startsWith('SET_LANG_')) {
        user.language = payload.split('_')[2].toLowerCase();
        await user.save(); return user.isLoggedIn ? sendMenu(psid, user) : sendAuth(psid, user);
    }

    if (payload === 'START_ORDER') {
        return sendButtons(psid, "ProxyFlow Shop :", [
            { "title": "⚡ Paid Proxies", "payload": "MENU_PAID" },
            { "title": i18n.free[lang], "payload": "GET_FREE" }
        ]);
    }

    if (payload === 'GET_FREE') {
        const proxy = await ProxyStock.findOne({ type: 'Free', isUsed: false });
        if (!proxy) return sendText(psid, "❌ Plus de stock gratuit / No stock.");
        
        proxy.isUsed = true; proxy.ownerPsid = psid; await proxy.save();
        await Order.create({ psid, email: user.email, product: "Free Proxy", quantity: 1, totalPrice: 0, status: "Livré" });
        
        return sendText(psid, `🎁 Proxy Gratuit :\n\n${proxy.data}`);
    }

    if (payload === 'MENU_PAID') {
        return sendButtons(psid, "Categories :", [
            { "title": "Verizon ($4.5)", "payload": "BUY_VERIZON_4.5" },
            { "title": "Virgin ($6)", "payload": "BUY_VIRGIN_6" },
            { "title": "Static ISP ($6)", "payload": "BUY_STATIC_6" }
        ]);
    }

    if (payload.startsWith('BUY_')) {
        const [,, item, price] = payload.split('_');
        user.selectedItem = item; user.selectedPrice = parseFloat(price);
        user.step = 'ASK_QTY'; await user.save();
        return sendText(psid, "Combien en voulez-vous ?");
    }

    if (payload === 'MY_ACCOUNT') {
        return sendButtons(psid, `👤 ${user.email}`, [
            { "title": i18n.my_proxies[lang], "payload": "VIEW_MY_PROXIES" },
            { "title": i18n.logout[lang], "payload": "LOGOUT" },
            { "title": "🌐 Langue", "payload": "CHANGE_LANG" }
        ]);
    }

    if (payload === 'VIEW_MY_PROXIES') {
        const myProxies = await ProxyStock.find({ ownerPsid: psid });
        if (myProxies.length === 0) return sendText(psid, "📭 Vous n'avez pas encore de proxy actif.");
        
        let msg = "🔑 VOS PROXIES ACTIVÉS :\n";
        myProxies.forEach(p => msg += `\n• ${p.type}: ${p.data}`);
        return sendText(psid, msg);
    }

    if (payload === 'LOGOUT') { user.isLoggedIn = false; await user.save(); return sendAuth(psid, user); }
    if (payload === 'CHANGE_LANG') return sendLanguagePicker(psid);
}

// --- LOGIQUE TEXTE ---
async function handleMessage(psid, text, user) {
    if (text.toLowerCase() === "menu") { user.step = 'IDLE'; await user.save(); return sendMenu(psid, user); }

    // Inscription (Captcha)
    if (user.step === 'SIGNUP_EMAIL') {
        user.email = text.trim().toLowerCase();
        user.captchaCode = Math.floor(1000 + Math.random() * 9000).toString();
        user.step = 'VERIFY_CAPTCHA'; await user.save();
        return sendText(psid, `🤖 CAPTCHA : ${user.captchaCode}`);
    }
    if (user.step === 'VERIFY_CAPTCHA') {
        if (text.trim() === user.captchaCode) {
            user.step = 'SIGNUP_PASS'; await user.save();
            return sendText(psid, "Mot de passe :");
        }
        return sendText(psid, "❌ Code incorrect.");
    }
    if (user.step === 'SIGNUP_PASS') {
        user.password = text; user.isLoggedIn = true; user.step = 'IDLE'; await user.save();
        return sendMenu(psid, user);
    }

    // Gestion Achat
    if (user.step === 'ASK_QTY') {
        const qty = parseInt(text);
        if (isNaN(qty) || qty <= 0) return sendText(psid, "Nombre invalide.");
        const total = qty * user.selectedPrice;

        // Enregistrement pour l'ADMIN PANEL
        await Order.create({
            psid: psid, email: user.email,
            product: user.selectedItem, quantity: qty,
            totalPrice: total, status: 'Attente Paiement'
        });

        user.step = 'IDLE'; await user.save();
        return sendButtons(psid, `🛒 Commande enregistrée !\nTotal: $${total}\n\nPayez via le support pour recevoir vos IPs.`, [{ "title": "💳 Payer au Support", "url": SUPPORT_LINK }]);
    }

    if (!user.isLoggedIn) return sendAuth(psid, user);
    sendMenu(psid, user);
}

// --- HELPERS ---
function sendAuth(psid, user) {
    sendButtons(psid, "ProxyFlow 🌐", [{ "title": "Connexion", "payload": "GOTO_LOGIN" }, { "title": "Inscription", "payload": "GOTO_SIGNUP" }]);
}
function sendMenu(psid, user) {
    const l = user.language || 'fr';
    sendButtons(psid, `Menu ProxyFlow`, [{ "title": i18n.shop[l], "payload": "START_ORDER" }, { "title": i18n.acc[l], "payload": "MY_ACCOUNT" }]);
}
function sendLanguagePicker(psid) {
    sendButtons(psid, "Language / Teny :", [{ "title": "English 🇬🇧", "payload": "SET_LANG_EN" }, { "title": "Français 🇫🇷", "payload": "SET_LANG_FR" }, { "title": "Malagasy 🇲🇬", "payload": "SET_LANG_MG" }]);
}
function sendText(psid, text) { callAPI(psid, { text }); }
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

app.listen(process.env.PORT || 3000, () => console.log("🚀 Server Ready"));
