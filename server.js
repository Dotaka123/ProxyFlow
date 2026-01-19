const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const mongoose = require('mongoose');

const app = express().use(bodyParser.json());
app.get('/', (req, res) => res.send("🚀 ProxyFlow Bot & API is Live"));

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const MONGO_URI = process.env.MONGO_URI;
const SUPPORT_LINK = "https://www.facebook.com/profile.php?id=61586969783401";

mongoose.connect(MONGO_URI);

// --- MODÈLES (SYNCHRONISÉS AVEC TON ADMIN) ---
const User = mongoose.model('User', new mongoose.Schema({
    psid: String, 
    email: String, 
    password: { type: String, default: "" }, // Ajouté pour ton bot
    balance: { type: Number, default: 0 },
    language: { type: String, default: 'fr' },
    isLoggedIn: { type: Boolean, default: false },
    step: { type: String, default: 'IDLE' },
    captchaCode: String, selectedItem: String, selectedPrice: Number
}));

const Order = mongoose.model('Order', new mongoose.Schema({
    psid: String, 
    orderId: String, 
    provider: String, 
    price: Number,
    status: { type: String, default: 'PENDING' }, 
    proxyData: String, 
    date: { type: Date, default: Date.now }
}));

const Settings = mongoose.model('Settings', new mongoose.Schema({
    key: String, value: String
}));

// --- LOGIQUE BOUTONS ---
async function handlePostback(psid, payload, user) {
    if (payload === 'START_ORDER') {
        return sendButtons(psid, "Sélectionnez une catégorie :", [
            { "title": "Static ISP ($6.0)", "payload": "CAT_ISP" },
            { "title": "Virgin Resi ($6.0)", "payload": "CAT_VIRGIN" },
            { "title": "Verizon ($4.5)", "payload": "CAT_VERIZON" }
        ]);
    }

    if (payload === 'CAT_ISP') {
        return sendButtons(psid, "Static ISP (Renewable - 0 Fraud):", [
            { "title": "USA ($6.0)", "payload": "BUY_ISPUSA_6" },
            { "title": "UK ($6.0)", "payload": "BUY_ISPUK_6" },
            { "title": "Australia ($6.0)", "payload": "BUY_ISPAU_6" }
        ]);
    }

    if (payload === 'CAT_VIRGIN') {
        return sendButtons(psid, "Virgin Resi (Min 10 IPs):", [
            { "title": "AT&T (HTTP)", "payload": "BUY_VATT_6" },
            { "title": "Windstream (S5)", "payload": "BUY_VWIND_6" }
        ]);
    }

    if (payload.startsWith('BUY_')) {
        const parts = payload.split('_');
        user.selectedItem = parts[1]; 
        user.selectedPrice = parseFloat(parts[2]);
        user.step = 'ASK_QTY'; 
        await user.save();
        return sendText(psid, `Combien d'unités pour ${user.selectedItem} ? ${user.selectedItem.includes('V') ? "(Min 10)" : ""}`);
    }

    if (payload === 'MY_ACCOUNT') {
        return sendButtons(psid, `👤 ${user.email}\n💰 Solde: $${user.balance}`, [
            { "title": "🔑 Mes Proxies", "payload": "VIEW_PROXIES" },
            { "title": "🔴 Déconnexion", "payload": "LOGOUT" }
        ]);
    }

    if (payload === 'VIEW_PROXIES') {
        const orders = await Order.find({ psid, status: 'DELIVERED' });
        if (orders.length === 0) return sendText(psid, "Aucun proxy actif.");
        let msg = "🔑 VOS ACCÈS :\n";
        orders.forEach(o => msg += `\n📦 ${o.provider}:\n${o.proxyData}\n`);
        return sendText(psid, msg);
    }
}

// --- LOGIQUE MESSAGE (ENREGISTREMENT ADMIN) ---
async function handleMessage(psid, text, user) {
    // Inscription Captcha (Simplifié pour l'exemple)
    if (user.step === 'SIGNUP_EMAIL') {
        user.email = text.trim();
        user.step = 'SIGNUP_PASS'; await user.save();
        return sendText(psid, "Choisissez un mot de passe :");
    }
    if (user.step === 'SIGNUP_PASS') {
        user.password = text; user.isLoggedIn = true; user.step = 'IDLE'; await user.save();
        return sendMenu(psid, user);
    }

    // ACHAT -> CONNEXION ADMIN PANEL
    if (user.step === 'ASK_QTY') {
        const qty = parseInt(text);
        if (isNaN(qty) || qty <= 0) return sendText(psid, "Nombre invalide.");
        
        // Check minimum Virgin
        if ((user.selectedItem === 'VATT' || user.selectedItem === 'VWIND') && qty < 10) {
            return sendText(psid, "⚠️ Minimum 10 IPs requis pour Virgin.");
        }

        const total = qty * user.selectedPrice;
        const generatedOrderId = "ORD-" + Math.random().toString(36).substr(2, 9).toUpperCase();

        // CRÉATION DE LA COMMANDE (CHAMPS EXACTS DU PANEL)
        await Order.create({
            psid: psid,
            orderId: generatedOrderId,
            provider: `${qty}x ${user.selectedItem}`,
            price: total,
            status: 'PENDING' // Pour que l'admin le voie direct
        });

        user.step = 'IDLE'; await user.save();
        return sendButtons(psid, `✅ Commande ${generatedOrderId} enregistrée !\nTotal: $${total.toFixed(2)}\n\nPayez au support pour recevoir vos IPs.`, [
            { "title": "💳 Payer au Support", "url": SUPPORT_LINK }
        ]);
    }

    if (!user.isLoggedIn) return sendAuth(psid, user);
    sendMenu(psid, user);
}

// --- HELPERS FB ---
function sendAuth(psid) { sendButtons(psid, "ProxyFlow 🌐", [{ "title": "Connexion", "payload": "GOTO_LOGIN" }, { "title": "Inscription", "payload": "GOTO_SIGNUP" }]); }
function sendMenu(psid, user) { sendButtons(psid, `Menu | $${user.balance}`, [{ "title": "🛒 Boutique", "payload": "START_ORDER" }, { "title": "👤 Compte", "payload": "MY_ACCOUNT" }]); }
function sendText(psid, text) { callAPI(psid, { text }); }
function sendButtons(psid, text, buttons) {
    const btns = buttons.map(b => b.url ? { type: "web_url", title: b.title, url: b.url } : { type: "postback", title: b.title, payload: b.payload });
    callAPI(psid, { attachment: { type: "template", payload: { template_type: "button", text, buttons: btns } } });
}
function callAPI(psid, message) { axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, { recipient: { id: psid }, message }).catch(e => {}); }

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

app.get('/webhook', (req, res) => { if (req.query['hub.verify_token'] === 'tata') res.send(req.query['hub.challenge']); });
app.listen(process.env.PORT || 3000);
