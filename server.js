const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const mongoose = require('mongoose');

const app = express().use(bodyParser.json());

// --- CONFIGURATION ---
const PAGE_ACCESS_TOKEN = 'EAAI12hLrtqEBQXKdwMnbFTZCdXyEXHVWUsewGrZAK28NrIvSJZAS2mOQt1K7GbrfFdBgjJgtae4LxVaPJ2UPf3c20YAlvZAypZBk7jahFt7qu3wCyuUaIci5IsgI7ovwLXKJQiNUgvTUNjC08ECSv9xir82e8MKDzKMkyAag8ABgrPC3wjkNbGf2gUA5aX4NW9aP5y8S7pRFMiISunGCD0HGYNAZDZD';
const VERIFY_TOKEN = 'tata';
const MONGO_URI = 'mongodb+srv://rakotoniainalahatra3_db_user:RXy0cKTSWpXtgCUA@cluster0.gzeshjm.mongodb.net/proxyflow?retryWrites=true&w=majority';

mongoose.connect(MONGO_URI).then(() => console.log("✅ MongoDB Connecté"));

// --- MODÈLES MONGODB ---
const User = mongoose.model('User', new mongoose.Schema({
    psid: { type: String, unique: true },
    email: String, password: String,
    balance: { type: Number, default: 0 },
    isLoggedIn: { type: Boolean, default: false },
    step: { type: String, default: 'IDLE' },
    captchaAnswer: Number
}));

const Order = mongoose.model('Order', new mongoose.Schema({
    psid: String,
    orderId: String,
    method: String,
    provider: String,
    status: { type: String, default: 'EN ATTENTE' }, // EN ATTENTE, LIVRÉ
    proxyData: { type: String, default: "" }, // IP:PORT:USER:PASS
    expiresAt: Date,
    date: { type: Date, default: Date.now }
}));

// --- WEBHOOK ENDPOINTS ---
app.get('/webhook', (req, res) => {
    if (req.query['hub.verify_token'] === VERIFY_TOKEN) res.status(200).send(req.query['hub.challenge']);
});

app.post('/webhook', async (req, res) => {
    let body = req.body;
    if (body.object === 'page') {
        for (const entry of body.entry) {
            if (!entry.messaging) continue;
            let event = entry.messaging[0];
            let psid = event.sender.id;
            let user = await User.findOne({ psid }) || await User.create({ psid });

            if (event.message && event.message.text) {
                handleMessage(psid, event.message.text, user);
            } else if (event.postback) {
                handlePostback(psid, event.postback.payload, user);
            }
        }
        res.status(200).send('EVENT_RECEIVED');
    }
});

// --- LOGIQUE DES MESSAGES TEXTES ---
async function handleMessage(psid, text, user) {
    if (user.step === 'SIGNUP_EMAIL') { user.email = text; user.step = 'SIGNUP_PASS'; await user.save(); return sendText(psid, "🔐 Choisissez un mot de passe :"); }
    if (user.step === 'SIGNUP_PASS') { 
        user.password = text; const n1 = Math.floor(Math.random()*10), n2 = Math.floor(Math.random()*10);
        user.captchaAnswer = n1 + n2; user.step = 'SIGNUP_CAPTCHA'; await user.save();
        return sendText(psid, `🤖 Captcha : Combien font ${n1} + ${n2} ?`);
    }
    if (user.step === 'SIGNUP_CAPTCHA') {
        if (parseInt(text) === user.captchaAnswer) { user.isLoggedIn = true; user.step = 'IDLE'; await user.save(); return sendWelcomeMenu(psid, user); }
        return sendText(psid, "❌ Calcul faux. Réessayez.");
    }
    if (user.step === 'LOGIN_EMAIL') { user.email = text; user.step = 'LOGIN_PASS'; await user.save(); return sendText(psid, "🔑 Votre mot de passe :"); }
    if (user.step === 'LOGIN_PASS') {
        const account = await User.findOne({ email: user.email, password: text });
        if (account) { user.isLoggedIn = true; user.step = 'IDLE'; await user.save(); return sendWelcomeMenu(psid, user); }
        return sendText(psid, "❌ Email ou mot de passe incorrect.");
    }
    if (user.step === 'AWAITING_BINANCE_ID') {
        user.step = 'IDLE'; await user.save();
        return sendText(psid, `✅ ID ${text} reçu. Un admin vérifiera votre transfert.`);
    }
    if (!user.isLoggedIn) return sendAuthPrompt(psid);
    sendWelcomeMenu(psid, user);
}

// --- LOGIQUE DES BOUTONS ---
async function handlePostback(psid, payload, user) {
    if (payload === 'GOTO_SIGNUP') { user.step = 'SIGNUP_EMAIL'; await user.save(); return sendText(psid, "📧 Entrez votre email :"); }
    if (payload === 'GOTO_LOGIN') { user.step = 'LOGIN_EMAIL'; await user.save(); return sendText(psid, "📧 Entrez votre email :"); }
    if (!user.isLoggedIn) return sendAuthPrompt(psid);

    switch (payload) {
        case 'MY_ACCOUNT':
            return sendButtons(psid, `👤 ${user.email}\n💰 Solde : ${user.balance}$`, [
                { "title": "📡 Mes Proxys", "payload": "MY_PROXIES" },
                { "title": "➕ Recharger", "payload": "ADD_FUNDS" },
                { "title": "📜 Historique", "payload": "MY_ORDERS" }
            ]);

        case 'MY_PROXIES':
            const activeProxies = await Order.find({ psid, status: 'LIVRÉ', expiresAt: { $gt: new Date() } });
            if (activeProxies.length === 0) return sendText(psid, "❌ Aucun proxy actif trouvé.");
            let pMsg = "📡 Vos accès Proxy :\n";
            activeProxies.forEach(p => {
                const days = Math.ceil((p.expiresAt - new Date()) / (1000*60*60*24));
                pMsg += `\n📍 ISP: ${p.provider}\n🔑 Accès: ${p.proxyData}\n⏳ Expire: ${days}j\n---`;
            });
            return sendText(psid, pMsg);

        case 'MY_ORDERS':
            const orders = await Order.find({ psid }).sort({ date: -1 }).limit(5);
            if (orders.length === 0) return sendText(psid, "📦 Aucune commande.");
            let list = "📋 Historique :\n";
            orders.forEach(o => list += `\n🔹 ${o.orderId} | ${o.status}\n   ISP: ${o.provider}`);
            return sendText(psid, list);

        case 'ADD_FUNDS':
            user.step = 'AWAITING_BINANCE_ID'; await user.save();
            return sendText(psid, "💰 Recharge (Min 4$)\n\nBinance ID: 1192024137\n\nTapez votre ID Binance ici :");

        case 'START_ORDER':
            return sendButtons(psid, "🌍 Étape 1 : Pays", [{ "title": "🇺🇸 USA", "payload": "S_PROV" }]);

        case 'S_PROV':
            return sendButtons(psid, "📶 Étape 2 : Fournisseur (4$)", [{ "title": "Verizon", "payload": "P_Verizon" }, { "title": "T-Mobile", "payload": "P_TMobile" }]);

        case payload.startsWith('P_') ? payload : null:
            const isp = payload.replace('P_', '');
            return sendButtons(psid, `💳 Proxy ${isp} (4$)\nPayer par :`, [
                { "title": `💰 Solde (${user.balance}$)`, "payload": `F_BAL_${isp}` },
                { "title": "🆔 Binance", "payload": `F_BIN_${isp}` },
                { "title": "🚀 LTC", "payload": `F_LTC_${isp}` }
            ]);

        case payload.startsWith('F_') ? payload : null:
            const parts = payload.split('_');
            const method = parts[1];
            const provider = parts[2];
            const oid = "PF" + Math.floor(Math.random()*900000);

            if (method === 'BAL') {
                if (user.balance >= 4) {
                    user.balance -= 4;
                    const expiry = new Date(); expiry.setDate(expiry.getDate() + 30);
                    // Ici on simule l'attribution d'un proxy du stock
                    const dummyProxy = "185.244.12.55:8080:user:pass";
                    await Order.create({ psid, orderId: oid, method: 'SOLDE', provider, status: 'LIVRÉ', proxyData: dummyProxy, expiresAt: expiry });
                    await user.save();
                    return sendText(psid, `✅ Achat réussi ! Proxy livré.\n\nConsultez le bouton "Mes Proxys" pour les accès.`);
                }
                return sendText(psid, "❌ Solde insuffisant.");
            }
            
            await Order.create({ psid, orderId: oid, method, provider, status: 'EN ATTENTE' });
            if (method === 'BIN') { user.step = 'AWAITING_BINANCE_ID'; await user.save(); }
            const instr = method === 'BIN' ? "Binance ID: 1192024137\nTapez votre ID ici." : "LTC: ltc1q64ycstakcvdycemj7tj9nexdnc25vv24l4vc8g";
            return sendText(psid, `🛒 Commande ${oid}\n\n${instr}`);
    }
}

// --- HELPERS ---
function sendAuthPrompt(psid) {
    sendButtons(psid, "ProxyFlow 🌐 | Bienvenue", [{ "title": "📝 S'inscrire", "payload": "GOTO_SIGNUP" }, { "title": "🔑 Connexion", "payload": "GOTO_LOGIN" }]);
}

function sendWelcomeMenu(psid, user) {
    sendButtons(psid, `Menu ProxyFlow 🌐 (Solde: ${user.balance}$)`, [
        { "title": "🛒 Acheter", "payload": "START_ORDER" },
        { "title": "👤 Mon Compte", "payload": "MY_ACCOUNT" }
    ]);
}

function sendText(psid, text) { callSendAPI(psid, { "text": text }); }

function sendButtons(psid, text, btns) {
    const buttons = btns.map(b => ({ "type": "postback", "title": b.title, "payload": b.payload }));
    callSendAPI(psid, { "attachment": { "type": "template", "payload": { "template_type": "button", "text": text, "buttons": buttons } } });
}

function callSendAPI(psid, response) {
    axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, { recipient: { id: psid }, message: response }).catch(e => {});
}

app.listen(3000, () => console.log("🚀 ProxyFlow v4.4 Complet !"));
