# TORIUM Virtual Renewals

## Obiettivo

La view `/renewals` pubblica una sequenza editoriale indipendente per ogni ipotesi di trasformazione. Il database, non il frontend, decide l'ordine della sequenza e permette di mescolare:

- render di rinnovo (`renewal`);
- fotografie dello stato attuale (`original`);
- planimetrie (`floor_plan`);
- dettagli e studi materici (`detail`, `material`).

Ogni progetto resta collegato a un record reale di `triage_source_listings`, all'identificativo del portale e al link dell'annuncio.

## Modello dati

- `renewal_styles`: ID stabile, nome, descrizione e palette dello stile.
- `virtual_renewals`: progetto/versione associato al listing sorgente e al relativo stile.
- `virtual_renewal_assets`: sequenza ordinata degli asset. `sort_order` stabilisce dove compaiono render, originali e piante nella rail orizzontale.
- bucket privato `torium-renewals`: contiene i file generati; il frontend riceve solo URL firmati temporanei.

Le tre tabelle hanno RLS attiva e nessun accesso `anon` o `authenticated`. Le scritture passano esclusivamente dagli endpoint server e richiedono `TORIUM_RENEWAL_AGENT_KEY`.

## Flusso agente

### 1. Crea il progetto

`POST /api/renewals`

Header:

```text
Authorization: Bearer $TORIUM_RENEWAL_AGENT_KEY
Content-Type: application/json
```

Body minimo:

```json
{
  "external_id": "gallura-villa-001-a1-v1",
  "listing": {
    "source_listing_row_id": 8908
  },
  "style": {
    "id": "a1_quiet_luxury",
    "name": "Quiet Mediterranean Luxury"
  },
  "title": "Gallura, imagined",
  "status": "processing",
  "version": 1,
  "assets": [
    {
      "asset_key": "original-soggiorno",
      "asset_kind": "original",
      "view_id": "v1",
      "view_name": "Soggiorno",
      "layout_type": "original",
      "sort_order": 10,
      "source_url": "https://img4.idealista.it/...jpg"
    },
    {
      "asset_key": "plan-01",
      "asset_kind": "floor_plan",
      "layout_type": "plan",
      "sort_order": 25,
      "source_url": "https://img4.idealista.it/...jpg"
    }
  ]
}
```

`source_listing_row_id` è la forma preferita. In alternativa si possono inviare `run_id`, `source_channel` e `source_listing_id`; l'API risolve comunque un listing già presente in TORIUM e usa i suoi dati sorgente.

### 2. Richiedi un upload firmato per ogni render

`POST /api/renewals?action=upload-url`

```json
{
  "external_id": "gallura-villa-001-a1-v1",
  "asset_key": "v1-soggiorno-a1",
  "asset_kind": "renewal",
  "view_id": "v1",
  "view_name": "Soggiorno",
  "layout_type": "hero",
  "sort_order": 20,
  "mime_type": "image/jpeg",
  "size_bytes": 7094752
}
```

La risposta contiene `upload.method`, `upload.url` e gli header da usare. L'URL è valido per due ore. Il file va caricato con una `PUT` binaria diretta a Supabase Storage; non va convertito in base64 e non deve passare attraverso Vercel.

### 3. Conferma asset e pubblicazione

`PATCH /api/renewals?external_id=gallura-villa-001-a1-v1`

```json
{
  "external_id": "gallura-villa-001-a1-v1",
  "status": "published",
  "asset_patches": [
    {
      "asset_key": "v1-soggiorno-a1",
      "upload_status": "ready",
      "width": 4096,
      "height": 2731,
      "caption": "Soggiorno · Quiet Mediterranean Luxury",
      "alt_text": "Render del soggiorno rinnovato"
    }
  ]
}
```

La pubblicazione è late-binding: finché il progetto non passa a `published` e gli asset a `ready`, non vengono mostrati nella view pubblica.

## Lettura pubblica

- `GET /api/renewals`: ultimi progetti pubblicati.
- `GET /api/renewals?external_id=...`: singolo progetto.
- `GET /api/renewals?style_id=a1_quiet_luxury`: filtro stile.
- `/renewals`: view editoriale.
- `/renewals?project=...`: view focalizzata su un progetto.

Gli URL degli asset privati scadono dopo un'ora e vengono rigenerati dal server.

## Caveat attuali

- Il listing deve già esistere in `triage_source_listings`.
- I file ammessi sono JPEG, PNG, WebP e AVIF, massimo 15 MB ciascuno.
- La relazione tra una vista originale e il suo render usa `view_id`; non viene ancora verificata con computer vision.
- La pubblicazione e l'ordine sono controllati dall'agente tramite `status`, `upload_status` e `sort_order`.
- Il frontend è pubblico in lettura; gli endpoint POST/PATCH sono server-to-server e non espongono la chiave nel browser.
