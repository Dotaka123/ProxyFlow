const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const mongoose = require('mongoose');

const app = express().use(bodyParser.json());

// --- CONFIGURATION (Vérifie bien tes tokens) ---
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
    step: { type: String, default: 'IDLE' },
    captchaAnswer: Number
}));

const Order = mongoose.model('Order', new mongoose.Schema({
    psid: String, orderId: String, method: String, provider: String, status: String, date: { type: Date, default: Date.now }
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
    if (user.step === 'SIGNUP_EMAIL') { user.email = text; user.step = 'SIGNUP_PASS'; await user.save(); return sendText(psid, "🔐 Mot de passe :"); }
    if (user.step === 'SIGNUP_PASS') { 
        user.password = text; const n1 = Math.floor(Math.random()*10), n2 = Math.floor(Math.random()*10);
        user.captchaAnswer = n1 + n2; user.step = 'SIGNUP_CAPTCHA'; await user.save();
        return sendText(psid, `🤖 Captcha : ${n1} + ${n2} = ?`);
    }
    if (user.step === 'SIGNUP_CAPTCHA') {
        if (parseInt(text) === user.captchaAnswer) { user.isLoggedIn = true; user.step = 'IDLE'; await user.save(); return sendWelcomeMenu(psid, user); }
        return sendText(psid, "❌ Faux. Réessayez.");
    }
    if (user.step === 'LOGIN_EMAIL') { user.email = text; user.step = 'LOGIN_PASS'; await user.save(); return sendText(psid, "🔑 Mot de passe :"); }
    if (user.step === 'LOGIN_PASS') {
        const acc = await User.findOne({ email: user.email, password: text });
        if (acc) { user.isLoggedIn = true; user.step = 'IDLE'; await user.save(); return sendWelcomeMenu(psid, user); }
        return sendText(psid, "❌ Erreur mot de passe.");
    }
    if (user.step === 'AWAITING_BINANCE_ID') {
        user.step = 'IDLE'; await user.save();
        return sendText(psid, `✅ ID ${text} enregistré. Un admin va valider.`);
    }

    if (!user.isLoggedIn) return sendAuthPrompt(psid);
    sendWelcomeMenu(psid, user);
}

// --- GESTION DES BOUTONS ---
async function handlePostback(psid, payload, user) {
    if (payload === 'GOTO_SIGNUP') { user.step = 'SIGNUP_EMAIL'; await user.save(); return sendText(psid, "📧 Email :"); }
    if (payload === 'GOTO_LOGIN') { user.step = 'LOGIN_EMAIL'; await user.save(); return sendText(psid, "📧 Email :"); }

    if (!user.isLoggedIn) return sendAuthPrompt(psid);

    // Système de détection de boutons simplifié
    if (payload === 'MY_ACCOUNT') {
        return sendButtons(psid, `👤 ${user.email}\n💰 Solde : ${user.balance}$`, [
            { "title": "➕ Recharger", "payload": "ADD_FUNDS" },
            { "title": "📜 Achats", "payload": "MY_ORDERS" }
        ]);
    }

    if (payload === 'ADD_FUNDS') {
        user.step = 'AWAITING_BINANCE_ID'; await user.save();
        return sendText(psid, "💰 Envoyez USDT -> Binance ID: 1192024137\n\nTapez votre ID Binance ici :");
    }

    if (payload === 'START_ORDER') {
        return sendButtons(psid, "🌍 Étape 1 : Pays", [{ "title": "🇺🇸 USA", "payload": "STEP_PROV" }]);
    }

    if (payload === 'STEP_PROV') {
        return sendButtons(psid, "📶 Étape 2 : Fournisseur (4$)", [
            { "title": "Verizon", "payload": "M_Verizon" },
            { "title": "T-Mobile", "payload": "M_TMobile" }
        ]);
    }

    // Gestion des méthodes de paiement
    if (payload.startsWith('M_')) {
        const pr = payload.replace('M_', '');
        return sendButtons(psid, `💳 Proxy ${pr} (4$)\nPayer par :`, [
            { "title": `Solde (${user.balance}$)`, "payload": `B_BAL_${pr}` },
            { "title": "Binance Pay", "payload": `B_BIN_${pr}` },
            { "title": "Litecoin", "payload": `B_LTC_${pr}` }
        ]);
    }

    // Traitement Final
    if (payload.startsWith('B_')) {
        const parts = payload.split('_'); // B, METHOD, PROVIDER
        const meth = parts[1];
        const prov = parts[2];
        const oid = "PF" + Math.floor(Math.random()*999);

        if (meth === 'BAL') {
            if (user.balance >= 4) {
                user.balance -= 4; await user.save();
                await Order.create({ psid, orderId: oid, method: 'SOLDE', provider: prov, status: 'LIVRÉ' });
                return sendText(psid, `✅ Payé ! Commande ${oid} livrée.`);
            }
            return sendText(psid, "❌ Solde insuffisant.");
        }
        
        await Order.create({ psid, orderId: oid, method: meth, provider: prov, status: 'ATTENTE' });
        const instr = (meth === 'BIN') ? "Binance ID: 1192024137\nTapez votre ID ici." : "LTC: ltc1q64ycstakcvdycemj7tj9nexdnc25vv24l4vc8g\nEnvoyez la preuve au support.";
        if (meth === 'BIN') { user.step = 'AWAITING_BINANCE_ID'; await user.save(); }
        return sendText(psid, `🛒 Commande ${oid}\n\n${instr}`);
    }
}

// --- HELPERS ---
function sendAuthPrompt(psid) {
    sendButtons(psid, "ProxyFlow 🌐 | Bienvenue", [{ "title": "📝 S'inscrire", "payload": "GOTO_SIGNUP" }, { "title": "🔑 Connexion", "payload": "GOTO_LOGIN" }]);
}
function sendWelcomeMenu(psid, user) {
    sendButtons(psid, `Menu (Solde: ${user.balance}$)`, [{ "title": "🛒 Acheter", "payload": "START_ORDER" }, { "title": "👤 Compte", "payload": "MY_ACCOUNT" }]);
}
function sendText(psid, text) { callSendAPI(psid, { "text": text }); }
function sendButtons(psid, text, btns) {
    const buttons = btns.map(b => ({ "type": "postback", "title": b.title, "payload": b.payload }));
    callSendAPI(psid, { "attachment": { "type": "template", "payload": { "template_type": "button", "text": text, "buttons": buttons } } });
}
function callSendAPI(psid, response) {
    axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, { recipient: { id: psid }, message: response }).catch(e => console.log("Erreur API"));
}

app.listen(3000, () => console.log("🚀 ProxyFlow v4.2 OK"));
