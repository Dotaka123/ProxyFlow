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

// --- MODÈLES ---
const User = mongoose.model('User', new mongoose.Schema({
    psid: { type: String, unique: true },
    email: String, password: String,
    balance: { type: Number, default: 0 },
    isLoggedIn: { type: Boolean, default: false },
    isRegistered: { type: Boolean, default: false },
    step: { type: String, default: 'IDLE' },
    captchaAnswer: Number
}));

const Order = mongoose.model('Order', new mongoose.Schema({
    psid: String, orderId: String, method: String, provider: String,
    status: { type: String, default: 'EN_ATTENTE' },
    date: { type: Date, default: Date.now }
}));

// --- WEBHOOK ---
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

// --- GESTION DES MESSAGES ---
async function handleMessage(psid, text, user) {
    // Inscription
    if (user.step === 'SIGNUP_EMAIL') { user.email = text; user.step = 'SIGNUP_PASS'; await user.save(); return sendText(psid, "🔐 Choisissez un mot de passe :"); }
    if (user.step === 'SIGNUP_PASS') { 
        user.password = text; const n1 = Math.floor(Math.random()*10), n2 = Math.floor(Math.random()*10);
        user.captchaAnswer = n1 + n2; user.step = 'SIGNUP_CAPTCHA'; await user.save();
        return sendText(psid, `🤖 Captcha : Combien font ${n1} + ${n2} ?`);
    }
    if (user.step === 'SIGNUP_CAPTCHA') {
        if (parseInt(text) === user.captchaAnswer) { user.isRegistered = true; user.isLoggedIn = true; user.step = 'IDLE'; await user.save(); return sendWelcomeMenu(psid, user); }
        return sendText(psid, "❌ Erreur de calcul. Réessayez.");
    }

    // Connexion
    if (user.step === 'LOGIN_EMAIL') { user.email = text; user.step = 'LOGIN_PASS'; await user.save(); return sendText(psid, "🔑 Entrez votre mot de passe :"); }
    if (user.step === 'LOGIN_PASS') {
        const acc = await User.findOne({ email: user.email, password: text });
        if (acc) { user.isLoggedIn = true; user.step = 'IDLE'; await user.save(); return sendWelcomeMenu(psid, user); }
        return sendText(psid, "❌ Mot de passe incorrect.");
    }

    // Réception ID Binance pour recharge ou paiement
    if (user.step === 'AWAITING_BINANCE_ID') {
        user.step = 'IDLE'; await user.save();
        return sendText(psid, `✅ ID Binance (${text}) reçu ! Un administrateur va vérifier et valider votre demande.`);
    }

    if (!user.isLoggedIn) return sendAuthPrompt(psid);
    sendWelcomeMenu(psid, user);
}

// --- GESTION DES BOUTONS ---
async function handlePostback(psid, payload, user) {
    if (payload === 'GOTO_SIGNUP') { user.step = 'SIGNUP_EMAIL'; await user.save(); return sendText(psid, "📧 Entrez votre email :"); }
    if (payload === 'GOTO_LOGIN') { user.step = 'LOGIN_EMAIL'; await user.save(); return sendText(psid, "📧 Entrez votre email :"); }

    if (!user.isLoggedIn) return sendAuthPrompt(psid);

    switch (payload) {
        case 'MY_ACCOUNT':
            const info = `👤 Compte : ${user.email}\n💰 Solde : ${user.balance}$`;
            sendButtons(psid, info, [
                { "title": "➕ Recharger", "payload": "ADD_FUNDS" },
                { "title": "📜 Mes Achats", "payload": "MY_ORDERS" }
            ]);
            break;

        case 'ADD_FUNDS':
            sendText(psid, "💰 Recharge (Min 4$) :\n\n1. Envoyez USDT -> Binance ID: 1192024137\n2. Tapez votre ID BINANCE ici.");
            user.step = 'AWAITING_BINANCE_ID';
            await user.save();
            break;

        case 'MY_ORDERS':
            const orders = await Order.find({ psid }).sort({ date: -1 }).limit(5);
            if (orders.length === 0) return sendText(psid, "Aucune commande trouvée.");
            let txt = "📋 Historique :\n";
            orders.forEach(o => txt += `\n🔹 ${o.orderId} | ${o.provider} | ${o.status}`);
            sendText(psid, txt);
            break;

        case 'START_ORDER':
            sendButtons(psid, "🌍 Étape 1 : Pays", [{ "title": "🇺🇸 USA", "payload": "STEP_PROV" }]);
            break;

        case 'STEP_PROV':
            sendButtons(psid, "📶 Étape 2 : Fournisseur (4$)", [
                { "title": "Verizon", "payload": "METHOD_Verizon" },
                { "title": "T-Mobile", "payload": "METHOD_TMobile" }
            ]);
            break;

        case payload.startsWith('METHOD_') ? payload : null:
            const prov = payload.replace('METHOD_', '');
            sendButtons(psid, `💳 Proxy ${prov} (4$)\nMode de paiement :`, [
                { "title": `💰 Solde (${user.balance}$)`, "payload": `BUY_BAL_${prov}` },
                { "title": "🆔 Binance Pay", "payload": `BUY_BIN_${prov}` },
                { "title": "🚀 Litecoin (LTC)", "payload": `BUY_LTC_${prov}` }
            ]);
            break;

        case payload.startsWith('BUY_BAL_') ? payload : null:
            const pB = payload.replace('BUY_BAL_', '');
            if (user.balance >= 4) {
                user.balance -= 4; await user.save();
                const id = "PF" + Math.floor(Math.random()*9999);
                await Order.create({ psid, orderId: id, method: 'SOLDE', provider: pB, status: 'LIVRÉ' });
                sendText(psid, `✅ Payé par solde ! Commande ${id} validée. Vos accès arrivent.`);
            } else {
                sendText(psid, `❌ Solde insuffisant (${user.balance}$). Rechargez ou utilisez Binance/LTC.`);
            }
            break;

        case payload.startsWith('BUY_BIN_') ? payload : null:
        case payload.startsWith('BUY_LTC_') ? payload : null:
            const isBin = payload.includes('BIN');
            const provider = payload.split('_')[2];
            const idPay = "PF" + Math.floor(Math.random()*9999);
            await Order.create({ psid, orderId: idPay, method: isBin ? 'BINANCE' : 'LTC', provider });
            const instr = isBin ? "Binance ID: 1192024137\nEnvoyez votre ID Binance ici." : "LTC: ltc1q64ycstakcvdycemj7tj9nexdnc25vv24l4vc8g\nContactez le support.";
            sendText(psid, `🛒 Commande ${idPay} (${provider})\n\n${instr}`);
            if (isBin) { user.step = 'AWAITING_BINANCE_ID'; await user.save(); }
            break;
    }
}

// --- HELPERS ---
function sendAuthPrompt(psid) {
    sendButtons(psid, "ProxyFlow 🌐 | Identifiez-vous :", [{ "title": "📝 S'inscrire", "payload": "GOTO_SIGNUP" }, { "title": "🔑 Connexion", "payload": "GOTO_LOGIN" }]);
}
function sendWelcomeMenu(psid, user) {
    sendButtons(psid, `Menu ProxyFlow 🌐 (Solde: ${user.balance}$)`, [{ "title": "🛒 Acheter", "payload": "START_ORDER" }, { "title": "👤 Compte", "payload": "MY_ACCOUNT" }]);
}
function sendText(psid, text) { callSendAPI(psid, { "text": text }); }
function sendButtons(psid, text, btns) {
    const buttons = btns.map(b => ({ "type": "postback", "title": b.title, "payload": b.payload }));
    callSendAPI(psid, { "attachment": { "type": "template", "payload": { "template_type": "button", "text": text, "buttons": buttons } } });
}
function callSendAPI(psid, response) {
    axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, { recipient: { id: psid }, message: response }).catch(e => {});
}

app.listen(3000, () => console.log("🚀 ProxyFlow v4.1 Terminé !"));
