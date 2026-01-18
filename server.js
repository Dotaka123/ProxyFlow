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
    email: String, 
    password: String,
    balance: { type: Number, default: 0 },
    isLoggedIn: { type: Boolean, default: false },
    isRegistered: { type: Boolean, default: false },
    step: { type: String, default: 'IDLE' },
    captchaAnswer: Number
}));

const Deposit = mongoose.model('Deposit', new mongoose.Schema({
    psid: String,
    binanceId: String,
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

// --- GESTION DES MESSAGES (TEXTE) ---
async function handleMessage(psid, text, user) {
    // 1. ÉTAPES D'INSCRIPTION (SIGNUP)
    if (user.step === 'SIGNUP_EMAIL') {
        user.email = text;
        user.step = 'SIGNUP_PASS';
        await user.save();
        return sendText(psid, "🔐 Choisissez un mot de passe :");
    } 
    if (user.step === 'SIGNUP_PASS') {
        user.password = text;
        const n1 = Math.floor(Math.random() * 10), n2 = Math.floor(Math.random() * 10);
        user.captchaAnswer = n1 + n2;
        user.step = 'SIGNUP_CAPTCHA';
        await user.save();
        return sendText(psid, `🤖 Captcha : Combien font ${n1} + ${n2} ?`);
    }
    if (user.step === 'SIGNUP_CAPTCHA') {
        if (parseInt(text) === user.captchaAnswer) {
            user.isRegistered = true;
            user.isLoggedIn = true;
            user.step = 'IDLE';
            await user.save();
            sendText(psid, "✅ Compte créé et connecté !");
            return sendWelcomeMenu(psid, user);
        }
        return sendText(psid, "❌ Erreur de calcul. Réessayez.");
    }

    // 2. ÉTAPES DE CONNEXION (LOGIN)
    if (user.step === 'LOGIN_EMAIL') {
        const foundUser = await User.findOne({ email: text });
        if (foundUser) {
            user.step = 'LOGIN_PASS';
            user.email = text; 
            await user.save();
            return sendText(psid, "🔑 Entrez votre mot de passe :");
        }
        return sendText(psid, "❌ Cet email n'existe pas. Réessayez ou créez un compte.");
    }
    if (user.step === 'LOGIN_PASS') {
        const account = await User.findOne({ email: user.email, password: text });
        if (account) {
            user.isLoggedIn = true;
            user.step = 'IDLE';
            await user.save();
            sendText(psid, "🔓 Connexion réussie !");
            return sendWelcomeMenu(psid, user);
        }
        return sendText(psid, "❌ Mot de passe incorrect.");
    }

    // 3. ÉTAPE DE DÉPÔT BINANCE
    if (user.step === 'AWAITING_DEPOSIT_ID') {
        await Deposit.create({ psid: psid, binanceId: text });
        user.step = 'IDLE';
        await user.save();
        return sendText(psid, `✅ ID Binance (${text}) reçu ! Un admin créditera votre solde après vérification.`);
    }

    // Sécurité : Si non connecté, forcer Auth
    if (!user.isLoggedIn) return sendAuthPrompt(psid);
    
    sendWelcomeMenu(psid, user);
}

// --- GESTION DES BOUTONS (POSTBACKS) ---
async function handlePostback(psid, payload, user) {
    if (payload === 'GOTO_SIGNUP') {
        user.step = 'SIGNUP_EMAIL'; await user.save();
        return sendText(psid, "📧 Entrez votre email :");
    }
    if (payload === 'GOTO_LOGIN') {
        user.step = 'LOGIN_EMAIL'; await user.save();
        return sendText(psid, "📧 Entrez votre email :");
    }

    if (!user.isLoggedIn) return sendAuthPrompt(psid);

    switch (payload) {
        case 'ADD_FUNDS':
            sendText(psid, "💰 Rechargement (Min 4$)\n\n1. Envoyez USDT -> Binance ID: 1192024137\n2. Tapez votre ID BINANCE ici.");
            user.step = 'AWAITING_DEPOSIT_ID';
            await user.save();
            break;
        case 'START_ORDER':
            if (user.balance < 4) return sendText(psid, `❌ Solde insuffisant (${user.balance}$).`);
            sendButtons(psid, "🌍 Étape 1 : Pays", [{ "title": "🇺🇸 USA", "payload": "BUY_USA" }]);
            break;
        case 'BUY_USA':
            sendButtons(psid, "📶 Étape 2 : Fournisseur (4$)", [
                { "title": "Verizon", "payload": "CONF_Verizon" },
                { "title": "T-Mobile", "payload": "CONF_TMobile" }
            ]);
            break;
        case 'CONF_Verizon':
        case 'CONF_TMobile':
            if (user.balance >= 4) {
                user.balance -= 4; await user.save();
                sendText(psid, `✅ Achat réussi ! Nouveau solde : ${user.balance}$`);
            }
            break;
        case 'MY_ACCOUNT':
            sendText(psid, `👤 ${user.email}\n💰 Solde : ${user.balance}$`);
            break;
    }
}

// --- HELPERS ---
function sendAuthPrompt(psid) {
    sendButtons(psid, "ProxyFlow 🌐 | Identifiez-vous :", [
        { "title": "📝 S'inscrire", "payload": "GOTO_SIGNUP" },
        { "title": "🔑 Se connecter", "payload": "GOTO_LOGIN" }
    ]);
}

function sendWelcomeMenu(psid, user) {
    sendButtons(psid, `Menu ProxyFlow 🌐 (Solde: ${user.balance}$)`, [
        { "title": "🛒 Acheter", "payload": "START_ORDER" },
        { "title": "💰 Recharger", "payload": "ADD_FUNDS" },
        { "title": "👤 Compte", "payload": "MY_ACCOUNT" }
    ]);
}

function sendText(psid, text) { callSendAPI(psid, { "text": text }); }

function sendButtons(psid, text, btns) {
    const buttons = btns.map(b => ({ "type": "postback", "title": b.title, "payload": b.payload }));
    callSendAPI(psid, { "attachment": { "type": "template", "payload": { "template_type": "button", "text": text, "buttons": buttons } } });
}

function callSendAPI(sender_psid, response) {
    axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
        recipient: { id: sender_psid },
        message: response
    }).catch(err => console.error("❌ Erreur API"));
}

app.listen(3000, () => console.log("🚀 ProxyFlow v3.1 Corrigé !"));
