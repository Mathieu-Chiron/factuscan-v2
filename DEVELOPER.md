# PaytAgences — Guide développeur

Ce document décrit le flux technique des deux chemins d'envoi vers PAYT : le push initial depuis **invoice-processor** et la mise à jour depuis **invoice-edit**. Il détaille les 10 cas de calcul des montants et indique pour chacun le test unitaire correspondant.

---

## Architecture

```
invoice-processor.html  (SPA unique-fichier)
├── /invoice-processor   → éditeur PDF + extraction Claude
│       ↓ pushAndExport()
│   api/payt-push.js     → contacts → debtors → invoices → avoir (Clôturée)
│
└── /invoices            → tableau des factures PAYT existantes
        ↓ invoice-edit
    api/payt-invoices-update.js  → invoices → avoir (Clôturée)
```

### Authentification

Clerk JS v4. Le token Clerk est passé dans le body de chaque appel API (`{ token, ... }`). Chaque route vérifie ce token côté serveur.

### Persistance locale

- `saveDataset()` — écrit en localStorage + DB (Vercel KV ou équivalent)
- `autoRestore()` — lit localStorage en priorité, puis DB ; filtre les factures déjà pushées (`pushStatus === 'success'`)

---

## Flux 1 — Upload + push initial (`api/payt-push.js`)

Le frontend appelle `pushAndExport()` après validation. Avant l'appel API, la fonction `applyAmountPaid()` **réduit** `invoice_open_amount_inc_vat` du montant payé saisi par l'utilisateur.

### Pipeline (4 étapes pour chaque administration)

1. `POST /v1/contacts` — upsert des contacts (dédupliqués par `contact_identifier`)
2. `POST /v1/debtors` — upsert des débiteurs (dédupliqués par `debtor_number`)
3. `POST /v1/invoices` — création des factures
4. `POST /v1/invoices` (×2) — si `payt_status = 'Clôturée'` : avoir + re-fermeture

> **Note** : `/v1/payments` retourne 405 (non supporté). Les paiements sont reflétés uniquement via `book_amount_open`.

### Champs envoyés à PAYT (étape 3)

| Champ PAYT          | Source frontend                              |
|---------------------|----------------------------------------------|
| `book_amount_total` | `invoice_total_amount_inc_vat`               |
| `amount_total`      | `invoice_total_amount_inc_vat`               |
| `book_amount_open`  | `invoice_open_amount_inc_vat` (déjà réduit)  |
| `amount_open`       | `invoice_open_amount_inc_vat`                |
| `category`          | `creditor_name`                              |

---

## Flux 2 — Mise à jour depuis invoice-edit (`api/payt-invoices-update.js`)

L'utilisateur ouvre une facture existante dans `/invoices`, renseigne un montant payé et/ou change le statut, puis clique **Envoyer sur PAYT**.

### Calcul de `book_amount_open` (côté API)

```js
const remaining = Math.max(0, open_amount - amount_paid);
book_amount_open = new_status === 'Payée' || new_status === 'Clôturée' ? '0' : String(remaining);
```

### Avoir pour Clôturée (côté API)

```js
const avoirAmount = Math.max(0, open_amount - amount_paid);
// si avoirAmount > 0 : POST credit note avec book_amount_total = -avoirAmount
```

Le numéro d'avoir est `AVOIR-{invoice_number}-{timestamp}` pour garantir l'unicité.

---

## Les 10 cas de calcul

### Cas 1 — Aucun paiement à l'upload

- **Contexte** : facture uploadée, montant payé = 0.
- **Frontend** : `invoice_open_amount_inc_vat` = `invoice_total_amount_inc_vat` (inchangé).
- **Envoyé à PAYT** : `book_amount_open = book_amount_total`.
- **Exemple** : total = 1 000 € → `book_amount_open = 1000`, `book_amount_total = 1000`.
- **Test** : `payt-push.test.js` → *"Cas 1 — aucun paiement : book_amount_open = book_amount_total"*

---

### Cas 2 — Paiement partiel à l'upload

- **Contexte** : l'utilisateur renseigne un montant payé < total dans l'éditeur.
- **Frontend** : `applyAmountPaid()` réduit `invoice_open_amount_inc_vat` = total − payé.
- **Envoyé à PAYT** : `book_amount_open = invoice_open_amount_inc_vat` (déjà réduit).
- **Exemple** : total = 1 000 €, payé = 400 € → `book_amount_open = 600`, `book_amount_total = 1000`.
  PAYT infère implicitement `amount_paid = total − open = 400`.
- **Test** : `payt-push.test.js` → *"Cas 2 — paiement partiel (réduit par le frontend) : book_amount_open = 600"*

---

### Cas 3 — Paiement total à l'upload

- **Contexte** : l'utilisateur renseigne payé = total.
- **Frontend** : `invoice_open_amount_inc_vat` = 0.
- **Envoyé à PAYT** : `book_amount_open = 0`, `book_amount_total = total`.
- **Exemple** : total = 1 000 €, payé = 1 000 € → `book_amount_open = 0`.
- **Test** : `payt-push.test.js` → *"Cas 3 — paiement total : book_amount_open = 0"*

---

### Cas 4 — Clôturée à l'upload, sans paiement préalable

- **Contexte** : `payt_status = 'Clôturée'`, aucun paiement.
- **Frontend** : `invoice_open_amount_inc_vat = invoice_total_amount_inc_vat`.
- **Étape 3** : `book_amount_open = invoice_open_amount_inc_vat`.
- **Étape 4a** : avoir `book_amount_total = −invoice_open_amount_inc_vat`, `book_amount_open = 0`.
- **Étape 4b** : re-POST de la facture originale avec `book_amount_open = 0`.
- **Exemple** : total = 1 000 €, open = 1 000 € → avoir = −1 000 €.
- **Test** : `payt-push.test.js` → *"avoir montant = open_amount quand amount_paid = 0"*

---

### Cas 5 — Clôturée à l'upload, avec paiement partiel

- **Contexte** : `payt_status = 'Clôturée'`, paiement partiel déjà appliqué par le frontend.
- **Frontend** : `invoice_open_amount_inc_vat` = total − payé = `effectiveOpen`.
- **Étape 3** : `book_amount_open = effectiveOpen`.
- **Étape 4a** : avoir `book_amount_total = −effectiveOpen`, `book_amount_open = 0`.
- **Étape 4b** : re-POST avec `book_amount_open = 0`.
- **Exemple** : total = 1 000 €, payé = 400 € → `effectiveOpen = 600` → avoir = −600 €.
- **Test** : `payt-push.test.js` → *"Cas 5 — Clôturée + paiement partiel (frontend) : avoir = effectiveOpen = 600"*

---

### Cas 6 — Payée via invoice-edit

- **Contexte** : l'utilisateur marque la facture comme Payée dans invoice-edit.
- **API** : `book_amount_open = 0` (statut Payée force open à 0 quelle que soit la saisie).
- **Pas d'avoir**.
- **Exemple** : open = 1 000 €, payé = 1 000 € → `book_amount_open = 0`.
- **Test** : `payt-invoices-update.test.js` → *"Payée : book_amount_open = 0"*

---

### Cas 7 — Clôturée via invoice-edit, sans paiement

- **Contexte** : `new_status = 'Clôturée'`, `amount_paid = 0`.
- **API** : `book_amount_open = 0` ; avoir = `open_amount − 0 = open_amount`.
- **Exemple** : open = 600 € → `book_amount_open = 0`, avoir = −600 €.
- **Test** : `payt-invoices-update.test.js` → *"Clôturée sans paiement : crée avoir = open_amount"*

---

### Cas 8 — Clôturée via invoice-edit, avec paiement partiel

- **Contexte** : `new_status = 'Clôturée'`, `amount_paid > 0`.
- **API** : `book_amount_open = 0` ; avoir = `open_amount − amount_paid`.
- **Exemple** : open = 1 000 €, payé = 400 € → `book_amount_open = 0`, avoir = −600 €.
- **Test** : `payt-invoices-update.test.js` → *"Clôturée avec paiement partiel : avoir = open - paid"*

---

### Cas 9 — Paiement partiel via invoice-edit (statut En cours)

- **Contexte** : `new_status = 'En cours'`, `amount_paid > 0`.
- **API** : `book_amount_open = open_amount − amount_paid` (≥ 0).
- **Pas d'avoir**.
- **Exemple** : open = 1 000 €, payé = 300 € → `book_amount_open = 700`.
- **Test** : `payt-invoices-update.test.js` → *"paiement partiel : book_amount_open = open - paid"*

---

### Cas 10 — Scénario deux phases

Scénario : un utilisateur uploade une facture avec un paiement partiel (phase 1), puis plus tard ferme la facture via invoice-edit (phase 2).

#### Phase 1 — Push initial (Cas 2)

- total = 1 000 €, payé = 400 € à l'upload.
- `book_amount_open = 600`, `book_amount_total = 1000` envoyés à PAYT.
- PAYT voit : solde ouvert = 600 €, paiement implicite = 400 €.
- **Test** : `payt-push.test.js` → *"Cas 10a — Phase 1 (push partiel) : book_amount_open = 600 envoyé à PAYT"*

#### Phase 2 — Fermeture via invoice-edit (Cas 7 avec open=600)

- L'utilisateur ouvre la facture dans `/invoices`, voit `open_amount = 600`.
- Marque Clôturée, `amount_paid = 0` (le paiement de 400 € est déjà enregistré côté PAYT).
- API : `book_amount_open = 0` ; avoir = 600 − 0 = −600 €.
- **Test** : `payt-invoices-update.test.js` → *"Cas 10b — Phase 2 : Clôturée via invoice-edit, solde restant=600, avoir=-600"*

---

## Lancer les tests

```bash
node tests/payt-push.test.js
node tests/payt-invoices-update.test.js
node tests/payt-debtor-category.test.js
node tests/isolation.test.js
```

Aucun framework externe requis — Node.js ≥ 18 suffit (ESM natif).

| Fichier de test                        | Cas couverts            | Tests |
|----------------------------------------|-------------------------|-------|
| `payt-push.test.js`                    | Cas 1, 2, 3, 4, 5, 10a | 22    |
| `payt-invoices-update.test.js`         | Cas 6, 7, 8, 9, 10b     | 20    |
| `payt-debtor-category.test.js`         | Catégorie créancier     | 11    |
| `isolation.test.js`                    | Isolation utilisateurs  | —     |

---

## Variables d'environnement

| Variable          | Description                                        |
|-------------------|----------------------------------------------------|
| `PAYT_PROXY_URL`  | Base URL PAYT (défaut : `https://api.paytsoftware.com/api`) |
| `FIXIE_URL`       | Proxy Fixie (IP statique) — format `http://fixie:TOKEN@host:port` |
| `PROXY_SECRET`    | Secret partagé entre frontend et API proxy         |
| `ANTHROPIC_API_KEY` | Clé Claude pour l'extraction PDF                 |
| `CLERK_SECRET_KEY` | Clé secrète Clerk pour la vérification des tokens |
