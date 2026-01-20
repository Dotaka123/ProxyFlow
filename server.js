const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const mongoose = require('mongoose');

const app = express().use(bodyParser.json());

app.get('/', (req, res) => res.send("🚀 ProxyFlow Bot API is Live."));

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const MONGO_URI = process.env.MONGO_URI;
const SUPPORT_LINK = "https://www.facebook.com/profile.php?id=61579023569844";

mongoose.connect(MONGO_URI);

const User = mongoose.model('User', new mongoose.Schema({
    psid: String, email: String, password: { type: String, default: "" },
    balance: { type: Number, default: 0 }, language: { type: String, default: 'fr' },
    isLoggedIn: { type: Boolean, default: false }, step: { type: String, default: 'IDLE' },
    captchaCode: String, selectedItem: String, selectedPrice: Number
}));

const Order = mongoose.model('Order', new mongoose.Schema({
    psid: String, orderId: String, provider: String, price: Number,
    status: { type: String, default: 'PENDING' }, proxyData: String, date: { type: Date, default: Date.now }
}));

const Settings = mongoose.model('Settings', new mongoose.Schema({ key: String, value: String }));

const validateEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

async function handleMessage(psid, event, user) {
    const text = event.text ? event.text.trim() : "";
    const payload = event.quick_reply ? event.quick_reply.payload : null;

    if (payload) {
        if (payload === 'MAIN_MENU') { user.step = 'IDLE'; await user.save(); return sendMenu(psid, user); }
        if (payload === 'LOGOUT') { user.isLoggedIn = false; user.step = 'IDLE'; await user.save(); return sendAuth(psid); }
        
        // --- TRIGGERS AUTH ---
        if (payload === 'GOTO_SIGNUP') { user.step = 'SIGNUP_EMAIL'; await user.save(); return sendText(psid, "📧 Inscription - Entrez votre email :"); }
        if (payload === 'GOTO_LOGIN') { user.step = 'LOGIN_EMAIL'; await user.save(); return sendText(psid, "🔐 Connexion - Entrez votre email :"); }

        // --- BOUTIQUE & COMPTE (Reste identique) ---
        if (payload === 'START_ORDER') {
            return sendQuickReplies(psid, "🛒 Boutique ProxyFlow :", [
                { title: "Static ISP ($6)", payload: "CAT_ISP" },
                { title: "Virgin Resi ($6)", payload: "CAT_VIRGIN" },
                { title: "Verizon ($4.5)", payload: "CAT_VERIZON" },
                { title: "🎁 Proxy Gratuit", payload: "GET_FREE" },
                { title: "🏠 Menu", payload: "MAIN_MENU" }
            ]);
        }
        if (payload === 'GET_FREE') {
            const freeSetting = await Settings.findOne({ key: 'free_proxies' });
            const msg = freeSetting ? `🎁 Proxies Gratuits :\n\n${freeSetting.value}` : "❌ Aucun stock gratuit.";
            return sendQuickReplies(psid, msg, [{ title: "🏠 Menu", payload: "MAIN_MENU" }]);
        }
        if (payload === 'MY_ACCOUNT') {
            return sendQuickReplies(psid, `👤 ${user.email}\n💰 Solde : $${user.balance.toFixed(2)}`, [
                { title: "🔑 Mes Proxies", payload: "VIEW_PROXIES" },
                { title: "🔴 Déconnexion", payload: "LOGOUT" },
                { title: "🏠 Menu", payload: "MAIN_MENU" }
            ]);
        }
        // ... (Gestion des CAT_ISP, BUY_ etc. identique au code précédent)
    }

    // --- LOGIQUE LOGIN ---
    if (user.step === 'LOGIN_EMAIL') {
        const foundUser = await User.findOne({ email: text.toLowerCase() });
        if (!foundUser) return sendText(psid, "❌ Aucun compte trouvé avec cet email. Réessayez :");
        user.email = text.toLowerCase(); // On stocke l'email pour vérifier le mot de passe après
        user.step = 'LOGIN_PASS'; await user.save();
        return sendText(psid, "🔑 Entrez votre mot de passe :");
    }
    if (user.step === 'LOGIN_PASS') {
        const realUser = await User.findOne({ email: user.email, password: text });
        if (realUser) {
            // On lie le nouveau PSID au compte existant
            realUser.psid = psid; realUser.isLoggedIn = true; realUser.step = 'IDLE'; await realUser.save();
            return sendMenu(psid, realUser);
        }
        return sendText(psid, "❌ Mot de passe incorrect. Réessayez :");
    }

    // --- LOGIQUE SIGNUP ---
    if (user.step === 'SIGNUP_EMAIL') {
        if (!validateEmail(text)) return sendText(psid, "❌ Email invalide. Réessayez :");
        const check = await User.findOne({ email: text.toLowerCase() });
        if (check) return sendText(psid, "⚠️ Cet email appartient déjà à un compte. Connectez-vous ou changez d'email :");
        user.email = text.toLowerCase();
        user.captchaCode = Math.floor(1000 + Math.random() * 9000).toString();
        user.step = 'VERIFY_CAPTCHA'; await user.save();
        return sendText(psid, `🤖 CAPTCHA : ${user.captchaCode}`);
    }
    if (user.step === 'VERIFY_CAPTCHA') {
        if (text === user.captchaCode) { user.step = 'SIGNUP_PASS'; await user.save(); return sendText(psid, "🔒 Créez un mot de passe :"); }
        return sendText(psid, "❌ Code incorrect.");
    }
    if (user.step === 'SIGNUP_PASS') {
        if (text.length < 4) return sendText(psid, "⚠️ Trop court (min 4 car.) :");
        user.password = text; user.isLoggedIn = true; user.step = 'IDLE'; await user.save();
        return sendMenu(psid, user);
    }

    // --- LOGIQUE QUANTITÉ ---
    if (user.step === 'ASK_QTY') {
        const qty = parseInt(text);
        if (isNaN(qty) || qty <= 0) return sendText(psid, "❌ Nombre invalide.");
        const total = qty * user.selectedPrice;
        const orderId = "ORD-" + Math.random().toString(36).substr(2, 6).toUpperCase();
        await Order.create({ psid, orderId, provider: `${qty}x ${user.selectedItem}`, price: total, status: 'PENDING' });
        user.step = 'IDLE'; await user.save();
        return sendQuickReplies(psid, `✅ Commande ${orderId} créée !\nTotal : $${total.toFixed(2)}`, [{ title: "🏠 Menu", payload: "MAIN_MENU" }]);
    }

    if (!user.isLoggedIn) return sendAuth(psid);
    sendMenu(psid, user);
}

// --- HELPERS ---
function sendQuickReplies(psid, text, options) {
    const quick_replies = options.map(opt => ({ content_type: "text", title: opt.title, payload: opt.payload }));
    callAPI(psid, { text, quick_replies });
}
function sendAuth(psid) { 
    sendQuickReplies(psid, "Bienvenue sur ProxyFlow 🌐", [
        { title: "Inscription", payload: "GOTO_SIGNUP" },
        { title: "Connexion", payload: "GOTO_LOGIN" }
    ]); 
}
function sendMenu(psid, user) {
    sendQuickReplies(psid, `Menu | Solde: $${user.balance.toFixed(2)}`, [{ title: "🛒 Boutique", payload: "START_ORDER" }, { title: "👤 Mon Compte", payload: "MY_ACCOUNT" }]);
}
function sendText(psid, text) { callAPI(psid, { text }); }
function callAPI(psid, message) { axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, { recipient: { id: psid }, message }).catch(e => {}); }

app.post('/webhook', async (req, res) => {
    const entry = req.body.entry[0];
    if (entry && entry.messaging) {
        const event = entry.messaging[0];
        const psid = event.sender.id;
        let user = await User.findOne({ psid });
        if (!user) user = await User.create({ psid });
        if (event.message) handleMessage(psid, event.message, user);
    }
    res.status(200).send('OK');
});

app.get('/webhook', (req, res) => { if (req.query['hub.verify_token'] === 'tata') res.send(req.query['hub.challenge']); });
app.listen(process.env.PORT || 3000);
