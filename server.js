const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const mongoose = require('mongoose');

const app = express().use(bodyParser.json());
app.get('/', (req, res) => res.send("🚀 ProxyFlow Online - Tarifs à jour"));

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const MONGO_URI = process.env.MONGO_URI;
const SUPPORT_LINK = "https://www.facebook.com/profile.php?id=61586969783401";

mongoose.connect(MONGO_URI);

// --- MODÈLES ---
const User = mongoose.model('User', new mongoose.Schema({
    psid: { type: String, unique: true }, 
    email: String, language: { type: String, default: 'fr' },
    isLoggedIn: { type: Boolean, default: false },
    step: { type: String, default: 'IDLE' },
    selectedItem: String, selectedPrice: Number
}));

const Order = mongoose.model('Order', new mongoose.Schema({
    psid: String, email: String, product: String, quantity: Number, totalPrice: Number, status: { type: String, default: 'Attente Paiement' }, createdAt: { type: Date, default: Date.now }
}));

const ProxyStock = mongoose.model('ProxyStock', new mongoose.Schema({
    type: String, data: String, isUsed: { type: Boolean, default: false }, ownerPsid: String
}));

// --- LOGIQUE BOUTONS ---
async function handlePostback(psid, payload, user) {
    const lang = user.language;

    if (payload === 'START_ORDER') {
        return sendButtons(psid, "Sélectionnez une catégorie :", [
            { "title": "Static ISP ($6.0)", "payload": "CAT_ISP" },
            { "title": "Virgin Resi ($6.0)", "payload": "CAT_VIRGIN" },
            { "title": "Verizon ($4.5)", "payload": "CAT_VERIZON" }
        ]);
    }

    // --- SOUS-MENUS TARIFS ---
    
    // 1. STATIC ISP
    if (payload === 'CAT_ISP') {
        return sendButtons(psid, "Static ISP (Renewable - 0 Fraud):\nUSA, UK, Australia", [
            { "title": "USA ($6.0)", "payload": "BUY_ISP-USA_6" },
            { "title": "UK ($6.0)", "payload": "BUY_ISP-UK_6" },
            { "title": "Australia ($6.0)", "payload": "BUY_ISP-AU_6" }
        ]);
    }

    // 2. VIRGIN RESIDENTIAL
    if (payload === 'CAT_VIRGIN') {
        return sendButtons(psid, "Virgin Residential (0 Fraud):\nMinimum 10 IPs", [
            { "title": "AT&T (HTTP)", "payload": "BUY_VIRGIN-ATT_6" },
            { "title": "Windstream (S5)", "payload": "BUY_VIRGIN-WIND_6" },
            { "title": "🎁 Free Proxy", "payload": "GET_FREE" }
        ]);
    }

    // 3. VERIZON
    if (payload === 'CAT_VERIZON') {
        return sendButtons(psid, "Verizon Static (VA, WA, NY, IL):\n$4.5 par IP", [
            { "title": "Acheter Verizon", "payload": "BUY_VERIZON-SPECIFIC_4.5" }
        ]);
    }

    // --- LOGIQUE COMMANDE ---
    if (payload.startsWith('BUY_')) {
        const [,, item, price] = payload.split('_');
        user.selectedItem = item; 
        user.selectedPrice = parseFloat(price);
        user.step = 'ASK_QTY'; 
        await user.save();
        
        if (item.includes('VIRGIN')) {
            return sendText(psid, "Virgin Residential: Minimum 10 IPs.\nCombien d'unités voulez-vous ?");
        }
        return sendText(psid, "Quelle quantité voulez-vous ?");
    }

    // --- AUTRES OPTIONS ---
    if (payload === 'MY_ACCOUNT') {
        return sendButtons(psid, `👤 ${user.email}`, [
            { "title": "🔑 Mes Proxies", "payload": "VIEW_MY_PROXIES" },
            { "title": "🔴 Déconnexion", "payload": "LOGOUT" }
        ]);
    }

    if (payload === 'VIEW_MY_PROXIES') {
        const proxies = await ProxyStock.find({ ownerPsid: psid });
        if (proxies.length === 0) return sendText(psid, "Aucun proxy actif.");
        let msg = "🔑 VOS PROXIES :\n";
        proxies.forEach(p => msg += `\n• ${p.type}: ${p.data}`);
        return sendText(psid, msg);
    }

    if (payload === 'GET_FREE') {
        const free = await ProxyStock.findOne({ type: 'Free', isUsed: false });
        if (!free) return sendText(psid, "Désolé, plus de stock gratuit.");
        free.isUsed = true; free.ownerPsid = psid; await free.save();
        return sendText(psid, `🎁 Votre Proxy Gratuit :\n${free.data}`);
    }
}

// --- LOGIQUE MESSAGE ---
async function handleMessage(psid, text, user) {
    if (user.step === 'ASK_QTY') {
        const qty = parseInt(text);
        if (isNaN(qty) || qty <= 0) return sendText(psid, "Veuillez entrer un nombre.");

        // Vérification du minimum pour Virgin
        if (user.selectedItem.includes('VIRGIN') && qty < 10) {
            return sendText(psid, "⚠️ Minimum 10 IPs pour Virgin Residential.");
        }

        const total = qty * user.selectedPrice;
        await Order.create({
            psid: psid, email: user.email,
            product: user.selectedItem, quantity: qty,
            totalPrice: total, status: 'Attente Paiement'
        });

        user.step = 'IDLE'; await user.save();
        return sendButtons(psid, `🛒 Commande: ${qty}x ${user.selectedItem}\nTotal: $${total}\n\nPayez au support pour recevoir vos accès.`, [
            { "title": "💳 Payer au Support", "url": SUPPORT_LINK }
        ]);
    }

    if (!user.isLoggedIn) return sendAuth(psid, user);
    sendMenu(psid, user);
}

// --- FONCTIONS DE BASE ---
function sendAuth(psid, user) {
    sendButtons(psid, "ProxyFlow 🌐", [{ "title": "Connexion", "payload": "GOTO_LOGIN" }, { "title": "Inscription", "payload": "GOTO_SIGNUP" }]);
}
function sendMenu(psid, user) {
    sendButtons(psid, "Menu Principal", [{ "title": "🛒 Boutique", "payload": "START_ORDER" }, { "title": "👤 Mon Compte", "payload": "MY_ACCOUNT" }]);
}
function sendText(psid, text) { callAPI(psid, { text }); }
function sendButtons(psid, text, buttons) {
    const btns = buttons.map(b => b.url ? { type: "web_url", title: b.title, url: b.url } : { type: "postback", title: b.title, payload: b.payload });
    callAPI(psid, { attachment: { type: "template", payload: { template_type: "button", text, buttons: btns } } });
}
function callAPI(psid, message) {
    axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, { recipient: { id: psid }, message }).catch(e => {});
}

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
