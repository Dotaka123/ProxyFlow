const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const mongoose = require('mongoose');

const app = express().use(bodyParser.json());

// 1. FIX "Cannot GET /" : Redirige vers ton panel admin ou affiche le statut
app.get('/', (req, res) => res.send("🚀 ProxyFlow Bot API is Live. Go to /admin/panel for Dashboard."));

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const MONGO_URI = process.env.MONGO_URI;
const SUPPORT_LINK = "https://www.facebook.com/profile.php?id=61579023569844";

mongoose.connect(MONGO_URI);

// --- MODÈLES (ALIGNÉS SUR TON ADMIN PANEL) ---
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

const Settings = mongoose.model('Settings', new mongoose.Schema({
    key: String, value: String
}));

// --- LOGIQUE MESSAGES & QUICK REPLIES ---
async function handleMessage(psid, event, user) {
    const text = event.text;
    const payload = event.quick_reply ? event.quick_reply.payload : null;

    if (payload) {
        if (payload === 'MAIN_MENU') return sendMenu(psid, user);

        // --- SECTION BOUTIQUE ---
        if (payload === 'START_ORDER') {
            return sendQuickReplies(psid, "🛒 Boutique ProxyFlow :", [
                { title: "Static ISP ($6)", payload: "CAT_ISP" },
                { title: "Virgin Resi ($6)", payload: "CAT_VIRGIN" },
                { title: "Verizon ($4.5)", payload: "CAT_VERIZON" },
                { title: "🎁 Proxy Gratuit", payload: "GET_FREE" },
                { title: "🏠 Menu", payload: "MAIN_MENU" }
            ]);
        }

        // --- FIX PROXY GRATUIT (SYNCHRO ADMIN) ---
        if (payload === 'GET_FREE') {
            const freeSetting = await Settings.findOne({ key: 'free_proxies' });
            const msg = freeSetting ? `🎁 Proxies Gratuits :\n\n${freeSetting.value}` : "❌ Aucun proxy gratuit disponible.";
            return sendQuickReplies(psid, msg, [{ title: "🏠 Menu", payload: "MAIN_MENU" }]);
        }

        if (payload === 'CAT_ISP') {
            return sendQuickReplies(psid, "Static ISP (0 Fraud) :", [
                { title: "USA ($6)", payload: "BUY_ISP-USA_6" },
                { title: "UK ($6)", payload: "BUY_ISP-UK_6" },
                { title: "AU ($6)", payload: "BUY_ISP-AU_6" },
                { title: "⬅️ Retour", payload: "START_ORDER" }
            ]);
        }

        if (payload === 'CAT_VIRGIN') {
            return sendQuickReplies(psid, "Virgin (Min 10) :", [
                { title: "AT&T (HTTP)", payload: "BUY_VIRGIN-ATT_6" },
                { title: "Windstream (S5)", payload: "BUY_VIRGIN-WIND_6" },
                { title: "⬅️ Retour", payload: "START_ORDER" }
            ]);
        }

        if (payload === 'CAT_VERIZON') {
            return sendQuickReplies(psid, "Verizon Static ($4.5) :", [
                { title: "Confirmer Verizon", payload: "BUY_VERIZON_4.5" },
                { title: "⬅️ Retour", payload: "START_ORDER" }
            ]);
        }

        if (payload.startsWith('BUY_')) {
            const parts = payload.split('_');
            user.selectedItem = parts[1];
            user.selectedPrice = parseFloat(parts[2]);
            user.step = 'ASK_QTY'; await user.save();
            return sendText(psid, `📍 Choix : ${user.selectedItem}\nCombien d'unités ?`);
        }

        // --- COMPTE ---
        if (payload === 'MY_ACCOUNT') {
            return sendQuickReplies(psid, `👤 ${user.email}\n💰 Solde : $${user.balance.toFixed(2)}`, [
                { title: "🔑 Mes Proxies", payload: "VIEW_PROXIES" },
                { title: "🏠 Menu", payload: "MAIN_MENU" }
            ]);
        }

        if (payload === 'VIEW_PROXIES') {
            const delivered = await Order.find({ psid, status: 'DELIVERED' });
            if (delivered.length === 0) return sendQuickReplies(psid, "📭 Pas de proxies actifs.", [{ title: "🏠 Menu", payload: "MAIN_MENU" }]);
            let msg = "🔑 VOS ACCÈS :\n";
            delivered.forEach(o => msg += `\n📦 ${o.provider}:\n${o.proxyData}\n`);
            return sendQuickReplies(psid, msg, [{ title: "🏠 Menu", payload: "MAIN_MENU" }]);
        }

        if (payload === 'GOTO_SIGNUP') { user.step = 'SIGNUP_EMAIL'; await user.save(); return sendText(psid, "📧 Votre email :"); }
    }

    // --- LOGIQUE TEXTE (QUANTITÉ / INSCRIPTION) ---
    if (user.step === 'ASK_QTY') {
        const qty = parseInt(text);
        if (isNaN(qty) || qty <= 0) return sendText(psid, "❌ Entrez un nombre.");
        if (user.selectedItem.includes('VIRGIN') && qty < 10) return sendText(psid, "⚠️ Min 10 IPs pour Virgin.");

        const total = qty * user.selectedPrice;
        const orderId = "ORD-" + Math.random().toString(36).substr(2, 6).toUpperCase();

        // Création commande alignée sur les filtres de ton admin (provider, price, orderId)
        await Order.create({ 
            psid, 
            orderId, 
            provider: `${qty}x ${user.selectedItem}`, 
            price: total, 
            status: 'PENDING' 
        });

        user.step = 'IDLE'; await user.save();
        return sendQuickReplies(psid, `✅ Commande ${orderId} créée !\nTotal : $${total.toFixed(2)}\n\nPayer ici : ${SUPPORT_LINK}`, [{ title: "🏠 Menu", payload: "MAIN_MENU" }]);
    }

    // Auth Flow
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

    if (!user.isLoggedIn) return sendAuth(psid);
    sendMenu(psid, user);
}

// --- HELPERS ---
function sendQuickReplies(psid, text, options) {
    const quick_replies = options.map(opt => ({ content_type: "text", title: opt.title, payload: opt.payload }));
    callAPI(psid, { text, quick_replies });
}

function sendAuth(psid) {
    sendQuickReplies(psid, "ProxyFlow 🌐", [{ title: "Inscription", payload: "GOTO_SIGNUP" }]);
}

function sendMenu(psid, user) {
    sendQuickReplies(psid, `Menu | Solde: $${user.balance.toFixed(2)}`, [
        { title: "🛒 Boutique", payload: "START_ORDER" },
        { title: "👤 Mon Compte", payload: "MY_ACCOUNT" }
    ]);
}

function sendText(psid, text) { callAPI(psid, { text }); }

function callAPI(psid, message) {
    axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, { recipient: { id: psid }, message }).catch(e => {});
}

// Webhook
app.post('/webhook', async (req, res) => {
    const entry = req.body.entry[0];
    if (entry && entry.messaging) {
        const event = entry.messaging[0];
        const psid = event.sender.id;
        let user = await User.findOne({ psid }) || await User.create({ psid });
        if (event.message) handleMessage(psid, event.message, user);
    }
    res.status(200).send('OK');
});

app.get('/webhook', (req, res) => { if (req.query['hub.verify_token'] === 'tata') res.send(req.query['hub.challenge']); });
app.listen(process.env.PORT || 3000);
