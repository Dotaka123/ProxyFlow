const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const mongoose = require('mongoose');

const app = express().use(bodyParser.json());

// --- 1. FIX "Cannot GET /" ---
app.get('/', (req, res) => res.send("🚀 ProxyFlow System is Live. Bot and Admin are connected."));

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const MONGO_URI = process.env.MONGO_URI;
const SUPPORT_LINK = "https://www.facebook.com/profile.php?id=61579023569844";

mongoose.connect(MONGO_URI);

// --- MODÈLES (SYNCHRONISÉS ADMIN) ---
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

// --- TRADUCTIONS ---
const i18n = {
    menu: { fr: "🏠 Menu Principal", en: "🏠 Main Menu", mg: "🏠 Menu Be" },
    shop: { fr: "🛒 Boutique", en: "🛒 Shop", mg: "🛒 Tsena" },
    acc: { fr: "👤 Mon Compte", en: "👤 Account", mg: "👤 Kaonty" }
};

// --- LOGIQUE PRINCIPALE ---
async function handleMessage(psid, event, user) {
    const text = event.text;
    const payload = event.quick_reply ? event.quick_reply.payload : null;
    const lang = user.language || 'fr';

    if (payload) {
        if (payload === 'MAIN_MENU') return sendMenu(psid, user);
        
        if (payload === 'START_ORDER') {
            return sendQuickReplies(psid, "Sélectionnez une catégorie :", [
                { title: "Static ISP ($6)", payload: "CAT_ISP" },
                { title: "Virgin Resi ($6)", payload: "CAT_VIRGIN" },
                { title: "Verizon ($4.5)", payload: "CAT_VERIZON" },
                { title: "🎁 Proxy Gratuit", payload: "GET_FREE" },
                { title: i18n.menu[lang], payload: "MAIN_MENU" }
            ]);
        }

        // --- 2. FIX PROXY GRATUIT (SYNCHRO ADMIN SETTINGS) ---
        if (payload === 'GET_FREE') {
            const freeSetting = await Settings.findOne({ key: 'free_proxies' });
            const msg = freeSetting ? `🎁 Voici vos proxies gratuits :\n\n${freeSetting.value}` : "❌ Aucun stock gratuit pour le moment.";
            return sendQuickReplies(psid, msg, [{ title: i18n.menu[lang], payload: "MAIN_MENU" }]);
        }

        if (payload === 'CAT_ISP') {
            return sendQuickReplies(psid, "Static ISP :", [
                { title: "USA ($6)", payload: "BUY_ISP-USA_6" },
                { title: "UK ($6)", payload: "BUY_ISP-UK_6" },
                { title: "AU ($6)", payload: "BUY_ISP-AU_6" },
                { title: "⬅️ Retour", payload: "START_ORDER" }
            ]);
        }

        if (payload === 'CAT_VIRGIN') {
            return sendQuickReplies(psid, "Virgin (Min 10 IPs) :", [
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
            return sendQuickReplies(psid, `📍 Choix : ${user.selectedItem}\nCombien d'unités voulez-vous ?`, [{ title: "🏠 Annuler", payload: "MAIN_MENU" }]);
        }

        if (payload === 'MY_ACCOUNT') {
            return sendQuickReplies(psid, `👤 ${user.email}\n💰 Solde: $${user.balance.toFixed(2)}`, [
                { title: "🔑 Mes Proxies", payload: "VIEW_PROXIES" },
                { title: "🌐 Langue", payload: "CHOOSE_LANG" },
                { title: "🔴 Déconnexion", payload: "LOGOUT" },
                { title: i18n.menu[lang], payload: "MAIN_MENU" }
            ]);
        }

        if (payload === 'CHOOSE_LANG') {
            return sendQuickReplies(psid, "Choisir langue :", [
                { title: "Français 🇫🇷", payload: "SET_LANG_fr" },
                { title: "English 🇬🇧", payload: "SET_LANG_en" },
                { title: "Malagasy 🇲🇬", payload: "SET_LANG_mg" }
            ]);
        }

        if (payload.startsWith('SET_LANG_')) {
            user.language = payload.split('_')[2];
            await user.save();
            return sendMenu(psid, user);
        }

        if (payload === 'VIEW_PROXIES') {
            const delivered = await Order.find({ psid, status: 'DELIVERED' });
            if (delivered.length === 0) return sendQuickReplies(psid, "📭 Aucun proxy actif.", [{ title: i18n.menu[lang], payload: "MAIN_MENU" }]);
            let msg = "🔑 VOS ACCÈS :\n";
            delivered.forEach(o => msg += `\n📦 ${o.provider}:\n${o.proxyData}\n`);
            return sendQuickReplies(psid, msg, [{ title: i18n.menu[lang], payload: "MAIN_MENU" }]);
        }

        if (payload === 'GOTO_SIGNUP') { user.step = 'SIGNUP_EMAIL'; await user.save(); return sendText(psid, "📧 Entrez votre email :"); }
        if (payload === 'LOGOUT') { user.isLoggedIn = false; await user.save(); return sendAuth(psid); }
    }

    // --- 3. GESTION DES TEXTES (QUANTITÉ & COMMANDES) ---
    if (user.step === 'ASK_QTY') {
        const qty = parseInt(text);
        if (isNaN(qty) || qty <= 0) return sendText(psid, "❌ Veuillez entrer un nombre valide.");
        if (user.selectedItem.includes('VIRGIN') && qty < 10) return sendText(psid, "⚠️ Minimum 10 IPs pour Virgin.");

        const total = qty * user.selectedPrice;
        const orderId = "ORD-" + Math.random().toString(36).substr(2, 6).toUpperCase();
        
        // Aligné sur ton panel admin
        await Order.create({ 
            psid, 
            orderId, 
            provider: `${qty}x ${user.selectedItem}`, 
            price: total, 
            status: 'PENDING' 
        });
        
        user.step = 'IDLE'; await user.save();
        return sendQuickReplies(psid, `✅ Commande ${orderId} créée !\nTotal : $${total.toFixed(2)}\n\nPayer ici : ${SUPPORT_LINK}`, [{ title: i18n.menu[lang], payload: "MAIN_MENU" }]);
    }

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
            return sendText(psid, "Choisissez un mot de passe :");
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
    sendQuickReplies(psid, "Bienvenue sur ProxyFlow 🌐", [{ title: "Inscription", payload: "GOTO_SIGNUP" }]);
}

function sendMenu(psid, user) {
    const l = user.language || 'fr';
    sendQuickReplies(psid, `ProxyFlow | Solde: $${user.balance.toFixed(2)}`, [
        { title: i18n.shop[l], payload: "START_ORDER" },
        { title: i18n.acc[l], payload: "MY_ACCOUNT" }
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
