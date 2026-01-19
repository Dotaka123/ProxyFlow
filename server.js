const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const mongoose = require('mongoose');

const app = express().use(bodyParser.json());

// Évite l'erreur "Cannot GET /"
app.get('/', (req, res) => res.send("🚀 ProxyFlow Bot & API is Live"));

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const MONGO_URI = process.env.MONGO_URI;
const SUPPORT_LINK = "https://www.facebook.com/profile.php?id=61550334805446";

mongoose.connect(MONGO_URI);

// --- MODÈLES (PARFAITEMENT ALIGNÉS AVEC TON ADMIN PANEL) ---
const User = mongoose.model('User', new mongoose.Schema({
    psid: String, 
    email: String, 
    password: { type: String, default: "" },
    balance: { type: Number, default: 0 },
    language: { type: String, default: 'fr' },
    isLoggedIn: { type: Boolean, default: false },
    step: { type: String, default: 'IDLE' },
    captchaCode: String, 
    selectedItem: String, 
    selectedPrice: Number
}));

const Order = mongoose.model('Order', new mongoose.Schema({
    psid: String, 
    orderId: String,    // Pour le bouton Deliver de l'admin
    provider: String,   // Nom du produit affiché sur l'admin
    price: Number,      // Prix total affiché sur l'admin
    status: { type: String, default: 'PENDING' }, // Filtre exact de l'admin
    proxyData: String,  // Contiendra les IPs après livraison
    date: { type: Date, default: Date.now }
}));

const Settings = mongoose.model('Settings', new mongoose.Schema({
    key: String, 
    value: String
}));

// --- LOGIQUE BOUTONS (POSTBACKS) ---
async function handlePostback(psid, payload, user) {
    const lang = user.language || 'fr';

    // Menu principal
    if (payload === 'START_ORDER') {
        return sendButtons(psid, "Sélectionnez une catégorie :", [
            { "title": "Static ISP ($6.0)", "payload": "CAT_ISP" },
            { "title": "Virgin Resi ($6.0)", "payload": "CAT_VIRGIN" },
            { "title": "Verizon ($4.5)", "payload": "CAT_VERIZON" }
        ]);
    }

    // Sous-menus Catégories
    if (payload === 'CAT_ISP') {
        return sendButtons(psid, "Static ISP (Renewable - 0 Fraud):", [
            { "title": "USA ($6.0)", "payload": "BUY_ISP-USA_6" },
            { "title": "UK ($6.0)", "payload": "BUY_ISP-UK_6" },
            { "title": "Australia ($6.0)", "payload": "BUY_ISP-AU_6" }
        ]);
    }

    if (payload === 'CAT_VIRGIN') {
        return sendButtons(psid, "Virgin Resi (Min 10 IPs):", [
            { "title": "AT&T (HTTP)", "payload": "BUY_VIRGIN-ATT_6" },
            { "title": "Windstream (S5)", "payload": "BUY_VIRGIN-WIND_6" }
        ]);
    }

    if (payload === 'CAT_VERIZON') {
        // FIX : Payload Verizon corrigé pour correspondre au splitter
        return sendButtons(psid, "Verizon Static (VA, WA, NY, IL):", [
            { "title": "Acheter Verizon ($4.5)", "payload": "BUY_VERIZON_4.5" }
        ]);
    }

    // Gestion de l'achat (UK, USA, Verizon, etc.)
    if (payload.startsWith('BUY_')) {
        const parts = payload.split('_'); 
        user.selectedItem = parts[1]; 
        user.selectedPrice = parseFloat(parts[2]);
        user.step = 'ASK_QTY'; 
        await user.save();
        
        let msg = `📍 Produit : ${user.selectedItem}\n💰 Prix : $${user.selectedPrice}/unité\n\n`;
        if (user.selectedItem.includes('VIRGIN')) msg += "⚠️ Rappel : Minimum 10 IPs requis.\n";
        msg += "Combien d'unités voulez-vous ?";
        
        return sendText(psid, msg);
    }

    // Mon Compte & Mes Proxies
    if (payload === 'MY_ACCOUNT') {
        return sendButtons(psid, `👤 ${user.email}\n💰 Solde: $${user.balance}`, [
            { "title": "🔑 Mes Proxies", "payload": "VIEW_PROXIES" },
            { "title": "🔴 Déconnexion", "payload": "LOGOUT" }
        ]);
    }

    if (payload === 'VIEW_PROXIES') {
        const delivered = await Order.find({ psid, status: 'DELIVERED' });
        if (delivered.length === 0) return sendText(psid, "📭 Aucun proxy actif pour le moment.");
        let msg = "🔑 VOS ACCÈS PROXY :\n";
        delivered.forEach(o => msg += `\n📦 ${o.provider}:\n${o.proxyData}\n`);
        return sendText(psid, msg);
    }

    if (payload === 'LOGOUT') { user.isLoggedIn = false; await user.save(); return sendAuth(psid); }
}

// --- LOGIQUE TEXTE (MESSAGES) ---
async function handleMessage(psid, text, user) {
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

    // Gestion de la Quantité -> ADMIN PANEL
    if (user.step === 'ASK_QTY') {
        const qty = parseInt(text);
        if (isNaN(qty) || qty <= 0) return sendText(psid, "❌ Veuillez entrer un nombre valide.");
        
        if (user.selectedItem.includes('VIRGIN') && qty < 10) {
            return sendText(psid, "⚠️ Minimum 10 IPs pour Virgin Residential.");
        }

        const total = qty * user.selectedPrice;
        const generatedOrderId = "ORD-" + Math.random().toString(36).substr(2, 9).toUpperCase();

        // Création de la commande avec les champs attendus par l'ADMIN
        await Order.create({
            psid: psid,
            orderId: generatedOrderId,
            provider: `${qty}x ${user.selectedItem}`,
            price: total,
            status: 'PENDING' // Indispensable pour l'affichage admin
        });

        user.step = 'IDLE'; await user.save();
        return sendButtons(psid, `✅ Commande ${generatedOrderId} créée !\nTotal: $${total.toFixed(2)}\n\nPayez au support pour recevoir vos accès.`, [
            { "title": "💳 Payer au Support", "url": SUPPORT_LINK },
            { "title": "🏠 Menu", "payload": "MAIN_MENU" }
        ]);
    }

    if (!user.isLoggedIn) return sendAuth(psid);
    sendMenu(psid, user);
}

// --- FONCTIONS HELPERS ---
function sendAuth(psid) {
    sendButtons(psid, "Bienvenue sur ProxyFlow 🌐", [
        { "title": "Connexion", "payload": "GOTO_LOGIN" },
        { "title": "Inscription", "payload": "GOTO_SIGNUP" }
    ]);
}

function sendMenu(psid, user) {
    sendButtons(psid, `Menu Principal | Solde: $${user.balance}`, [
        { "title": "🛒 Boutique", "payload": "START_ORDER" },
        { "title": "👤 Mon Compte", "payload": "MY_ACCOUNT" }
    ]);
}

function sendText(psid, text) { callAPI(psid, { text }); }

function sendButtons(psid, text, buttons) {
    const btns = buttons.map(b => b.url ? { type: "web_url", title: b.title, url: b.url } : { type: "postback", title: b.title, payload: b.payload });
    callAPI(psid, { attachment: { type: "template", payload: { template_type: "button", text, buttons: btns } } });
}

function callAPI(psid, message) {
    axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, { recipient: { id: psid }, message }).catch(e => {});
}

// --- WEBHOOK CONFIG ---
app.get('/webhook', (req, res) => {
    if (req.query['hub.verify_token'] === 'tata') res.send(req.query['hub.challenge']);
});

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 ProxyFlow Bot Ready on port ${PORT}`));
