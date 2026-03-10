/**
 * vproxy-routes.js
 * Module d'intégration de l'API vproxy.cc (Reseller)
 * À importer dans server.js : require('./vproxy-routes')(app, User);
 *
 * Pools pris en charge : residential, datacenter, residential_premium
 * Exclus : mobile, ISP (traités manuellement)
 *
 * Variables d'environnement requises :
 *   VPROXY_API_KEY   — votre clé API vproxy.cc
 *
 * Modèle User (mongoose) — champs supplémentaires attendus :
 *   vproxySubuserId : Number (optionnel, créé automatiquement)
 *   balance         : Number (solde en $ sur votre plateforme)
 */

const axios = require('axios');

// ─── Config ─────────────────────────────────────────────────────────────────
const VPROXY_BASE  = 'https://vproxy.cc/reseller-api';
const VPROXY_KEY   = process.env.VPROXY_API_KEY;

// Conversion : combien de GB vproxy on consomme pour 1 GB acheté sur notre plateforme
const POOL_CONV = {
    residential:         1,
    datacenter:          0.5,
    residential_premium: 4
};

// Plages de ports sticky réservées par pool (évite les conflits entre subusers)
const STICKY_RANGES = {
    residential:         [7000, 7099],
    datacenter:          [7100, 7199],
    residential_premium: [7200, 7249]
};

// Pools autorisés (pas mobile, pas ISP)
const ALLOWED_POOLS = ['residential', 'datacenter', 'residential_premium'];

// ─── Helpers ─────────────────────────────────────────────────────────────────
const vpApi = axios.create({
    baseURL: VPROXY_BASE,
    headers: { apikey: VPROXY_KEY, 'Content-Type': 'application/json' }
});

function authMiddleware(req, res, next) {
    // Récupère l'utilisateur depuis le middleware JWT existant (token Bearer)
    if (!req.user) return res.status(401).json({ error: 'Non authentifié.' });
    next();
}

async function ensureSubuser(user, pool) {
    /**
     * Retourne le subuser_id vproxy pour cet utilisateur et ce pool.
     * Crée un subuser si nécessaire et le sauvegarde sur l'utilisateur.
     */
    const fieldName = `vproxySubuserId_${pool}`;

    if (user[fieldName]) {
        // Vérifier que le subuser existe toujours
        try {
            await vpApi.get(`/subuser/get?subuser_id=${user[fieldName]}`);
            return user[fieldName];
        } catch (_) {
            // Subuser invalide ou supprimé — on le recrée
            user[fieldName] = null;
        }
    }

    // Créer un nouveau subuser
    const [sMin, sMax] = STICKY_RANGES[pool];
    const resp = await vpApi.post('/subuser/create', {
        pool_type:    pool,
        sticky_range: [sMin, sMax],
        threads:      50,
        allowed_ips:  [],
        default_pool_parameters: null
    });

    const newId = resp.data; // L'API retourne l'ID directement
    user[fieldName] = newId;
    await user.save();
    return newId;
}

// ─── Routes ──────────────────────────────────────────────────────────────────
module.exports = function mountVproxyRoutes(app, User) {

    /**
     * GET /api/vproxy/pools
     * Liste les pools disponibles avec leurs tarifs
     */
    app.get('/api/vproxy/pools', authMiddleware, (req, res) => {
        res.json([
            {
                key:         'residential',
                name:        'Residential',
                icon:        '🏠',
                badge:       'Furtif',
                description: 'IPs résidentielles légitimes. Idéal pour contourner les blocages.',
                volumes: [
                    { gb: 1,   price: 2.20  },
                    { gb: 5,   price: 10.50 },
                    { gb: 10,  price: 19.00 },
                    { gb: 50,  price: 85.00 },
                    { gb: 100, price: 145.00 }
                ],
                supportsSticky:   true,
                supportsRotating: true
            },
            {
                key:         'datacenter',
                name:        'Datacenter',
                icon:        '🏢',
                badge:       'Rapide',
                description: 'Proxies haute bande passante. Idéal pour scraping et automation.',
                volumes: [
                    { gb: 1,   price: 1.20  },
                    { gb: 5,   price: 5.50  },
                    { gb: 10,  price: 10.00 },
                    { gb: 50,  price: 47.00 },
                    { gb: 100, price: 85.00 }
                ],
                supportsSticky:   true,
                supportsRotating: true
            },
            {
                key:         'residential_premium',
                name:        'Residential Premium',
                icon:        '⚡',
                badge:       'Premium',
                description: 'Résidentiel haut de gamme avec rotation avancée. Vitesse et succès maximaux.',
                volumes: [
                    { gb: 1,   price: 5.80  },
                    { gb: 5,   price: 27.00 },
                    { gb: 10,  price: 52.00 },
                    { gb: 50,  price: 250.00 },
                    { gb: 100, price: 470.00 }
                ],
                supportsSticky:   true,
                supportsRotating: true
            }
        ]);
    });

    /**
     * GET /api/vproxy/countries?pool=residential
     * Retourne la liste des pays disponibles pour un pool
     */
    app.get('/api/vproxy/countries', authMiddleware, async (req, res) => {
        const { pool } = req.query;
        if (!ALLOWED_POOLS.includes(pool))
            return res.status(400).json({ error: 'Pool non autorisé.' });

        try {
            const resp = await vpApi.get(`/common/location/country?pool=${pool}&order_by=name`);
            res.json(resp.data);
        } catch (err) {
            res.status(500).json({ error: 'Impossible de récupérer les pays.', detail: err.message });
        }
    });

    /**
     * GET /api/vproxy/cities?pool=residential&countries={US}
     * Retourne les villes disponibles (filtrage optionnel par pays)
     */
    app.get('/api/vproxy/cities', authMiddleware, async (req, res) => {
        const { pool, countries } = req.query;
        if (!ALLOWED_POOLS.includes(pool))
            return res.status(400).json({ error: 'Pool non autorisé.' });

        try {
            let url = `/common/location/city?pool=${pool}`;
            if (countries) url += `&countries=${encodeURIComponent(countries)}`;
            const resp = await vpApi.get(url);
            res.json(resp.data);
        } catch (err) {
            res.status(500).json({ error: 'Impossible de récupérer les villes.', detail: err.message });
        }
    });

    /**
     * GET /api/vproxy/reseller-balance
     * Solde du revendeur vproxy (admin seulement)
     */
    app.get('/api/vproxy/reseller-balance', authMiddleware, async (req, res) => {
        if (!req.user.isAdmin)
            return res.status(403).json({ error: 'Accès refusé.' });

        try {
            const resp = await vpApi.get('/balance/get_full');
            res.json(resp.data);
        } catch (err) {
            res.status(500).json({ error: 'Impossible de récupérer le solde vproxy.' });
        }
    });

    /**
     * POST /api/vproxy/buy
     * Achat automatique de proxies via vproxy.cc
     *
     * Body:
     * {
     *   pool:        string  — residential | datacenter | residential_premium
     *   gb:          number  — volume en Go
     *   type:        string  — sticky | rotating (défaut: rotating)
     *   protocol:    string  — http | socks5 (défaut: http)
     *   quantity:    number  — nombre de proxies à retourner (défaut: 10)
     *   countries:   string  — ex: "{US,CA}" (optionnel)
     *   sessionttl:  number  — durée session sticky en secondes (défaut: 300)
     * }
     */
    app.post('/api/vproxy/buy', authMiddleware, async (req, res) => {
        const {
            pool,
            gb,
            type        = 'rotating',
            protocol    = 'http',
            quantity    = 10,
            countries   = '',
            cities      = '',
            sessionttl  = 300
        } = req.body;

        // ── Validations ─────────────────────────────────────────────────────
        if (!ALLOWED_POOLS.includes(pool))
            return res.status(400).json({ error: 'Pool invalide. Choisissez : residential, datacenter ou residential_premium.' });

        const gbInt = parseInt(gb);
        if (!gbInt || gbInt < 1)
            return res.status(400).json({ error: 'Volume invalide (minimum 1 Go).' });

        if (!['sticky', 'rotating'].includes(type))
            return res.status(400).json({ error: 'Type invalide : sticky ou rotating.' });

        if (!['http', 'socks5'].includes(protocol))
            return res.status(400).json({ error: 'Protocole invalide : http ou socks5.' });

        const qtInt = Math.min(Math.max(parseInt(quantity) || 10, 1), 100);

        // ── Calcul du prix ──────────────────────────────────────────────────
        const poolConfig = getPriceConfig(pool, gbInt);
        if (!poolConfig)
            return res.status(400).json({ error: 'Volume non disponible pour ce pool.' });

        const price = poolConfig.price;

        // ── Vérification du solde utilisateur ──────────────────────────────
        const user = await User.findById(req.user._id || req.user.id);
        if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });
        if (user.balance < price)
            return res.status(402).json({
                error: `Solde insuffisant. Vous avez $${user.balance.toFixed(2)}, il faut $${price.toFixed(2)}.`
            });

        // ── Création/récupération subuser vproxy ────────────────────────────
        let subuserId;
        try {
            subuserId = await ensureSubuser(user, pool);
        } catch (err) {
            console.error('[vproxy] ensureSubuser error:', err.message);
            return res.status(500).json({ error: 'Impossible de créer le compte proxy. Réessayez.' });
        }

        // ── Ajout du volume au subuser ─────────────────────────────────────
        try {
            await vpApi.post('/subuser/balance/add', { subuser_id: subuserId, gb: gbInt });
        } catch (err) {
            const code = err.response?.data?.code;
            if (code === 'PT402')
                return res.status(402).json({ error: 'Solde revendeur insuffisant. Contactez le support.' });
            console.error('[vproxy] balance/add error:', err.message);
            return res.status(500).json({ error: 'Impossible d\'ajouter le volume proxy.' });
        }

        // ── Récupération des proxies ────────────────────────────────────────
        let proxies;
        try {
            const params = new URLSearchParams({
                pool,
                subuser_id: subuserId,
                type,
                protocol,
                format:     'plain',
                quantity:   qtInt,
                sessionttl: type === 'sticky' ? sessionttl : undefined
            });
            if (countries) params.set('countries', countries);
            if (cities)    params.set('cities', cities);
            // Supprime les paramètres undefined
            for (const [k, v] of [...params]) { if (v === undefined || v === 'undefined') params.delete(k); }

            const resp = await vpApi.get(`/get-proxy?${params.toString()}`, {
                headers: { accept: 'text/plain' }
            });

            proxies = typeof resp.data === 'string'
                ? resp.data.trim().split('\n').filter(Boolean)
                : [];
        } catch (err) {
            // Rembourser le volume en cas d'échec
            try { await vpApi.post('/subuser/balance/dec', { subuser_id: subuserId, gb: gbInt }); } catch (_) {}
            console.error('[vproxy] get-proxy error:', err.message);
            return res.status(500).json({ error: 'Impossible de récupérer les proxies.' });
        }

        if (!proxies.length) {
            // Rembourser si aucun proxy reçu
            try { await vpApi.post('/subuser/balance/dec', { subuser_id: subuserId, gb: gbInt }); } catch (_) {}
            return res.status(500).json({ error: 'Aucun proxy disponible pour cette sélection.' });
        }

        // ── Déduction du solde utilisateur ─────────────────────────────────
        user.balance -= price;
        await user.save();

        // ── Réponse ─────────────────────────────────────────────────────────
        res.json({
            success:     true,
            pool,
            type,
            protocol,
            gb:          gbInt,
            price:       price,
            userBalance: user.balance,
            proxies,
            subuserId,
            message:     `${proxies.length} proxies ${pool} livrés avec succès.`
        });
    });

    /**
     * GET /api/vproxy/subuser-balance?pool=residential
     * Retourne le solde proxy restant de l'utilisateur pour un pool donné
     */
    app.get('/api/vproxy/subuser-balance', authMiddleware, async (req, res) => {
        const { pool } = req.query;
        if (!ALLOWED_POOLS.includes(pool))
            return res.status(400).json({ error: 'Pool invalide.' });

        try {
            const user = await User.findById(req.user._id || req.user.id);
            const fieldName = `vproxySubuserId_${pool}`;
            if (!user[fieldName]) return res.json({ bytes: 0, gb: 0, formatted: '0 GB' });

            const resp = await vpApi.get(`/subuser/balance/get?subuser_id=${user[fieldName]}`);
            res.json(resp.data);
        } catch (err) {
            res.status(500).json({ error: 'Impossible de récupérer le solde proxy.' });
        }
    });

    /**
     * POST /api/vproxy/get-proxies
     * Récupère des proxies supplémentaires depuis le solde existant (sans achat)
     * Body: { pool, type, protocol, quantity, countries, sessionttl }
     */
    app.post('/api/vproxy/get-proxies', authMiddleware, async (req, res) => {
        const { pool, type = 'rotating', protocol = 'http', quantity = 10, countries = '', sessionttl = 300 } = req.body;

        if (!ALLOWED_POOLS.includes(pool))
            return res.status(400).json({ error: 'Pool invalide.' });

        try {
            const user = await User.findById(req.user._id || req.user.id);
            const fieldName = `vproxySubuserId_${pool}`;
            if (!user[fieldName])
                return res.status(400).json({ error: 'Aucun compte proxy pour ce pool. Achetez d\'abord du volume.' });

            const params = new URLSearchParams({
                pool,
                subuser_id: user[fieldName],
                type,
                protocol,
                format:     'plain',
                quantity:   Math.min(parseInt(quantity) || 10, 100),
                sessionttl: type === 'sticky' ? sessionttl : undefined
            });
            if (countries) params.set('countries', countries);
            for (const [k, v] of [...params]) { if (v === undefined || v === 'undefined') params.delete(k); }

            const resp = await vpApi.get(`/get-proxy?${params.toString()}`, {
                headers: { accept: 'text/plain' }
            });

            const proxies = typeof resp.data === 'string'
                ? resp.data.trim().split('\n').filter(Boolean)
                : [];

            res.json({ success: true, proxies });
        } catch (err) {
            res.status(500).json({ error: 'Impossible de récupérer les proxies.' });
        }
    });

    // ─── Admin : liste des subusers ─────────────────────────────────────────
    app.get('/api/vproxy/admin/subusers', authMiddleware, async (req, res) => {
        if (!req.user.isAdmin) return res.status(403).json({ error: 'Accès refusé.' });
        try {
            const resp = await vpApi.get('/subuser/list?limit=1000&offset=0');
            res.json(resp.data);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
};

// ─── Helpers de prix ─────────────────────────────────────────────────────────
function getPriceConfig(pool, gb) {
    const tables = {
        residential: [
            { gb: 1,   price: 2.20  },
            { gb: 5,   price: 10.50 },
            { gb: 10,  price: 19.00 },
            { gb: 50,  price: 85.00 },
            { gb: 100, price: 145.00 }
        ],
        datacenter: [
            { gb: 1,   price: 1.20  },
            { gb: 5,   price: 5.50  },
            { gb: 10,  price: 10.00 },
            { gb: 50,  price: 47.00 },
            { gb: 100, price: 85.00 }
        ],
        residential_premium: [
            { gb: 1,   price: 5.80  },
            { gb: 5,   price: 27.00 },
            { gb: 10,  price: 52.00 },
            { gb: 50,  price: 250.00 },
            { gb: 100, price: 470.00 }
        ]
    };
    return (tables[pool] || []).find(r => r.gb === gb) || null;
}
