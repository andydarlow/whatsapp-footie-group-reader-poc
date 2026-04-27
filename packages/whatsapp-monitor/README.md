# @footie/whatsapp-monitor

Reads messages from a named WhatsApp group via Baileys and routes them onto Kafka topics:

- Messages beginning with `score` → `score` topic (with timestamp)
- Poll messages and poll votes → `poll` topic (with poll id, description, voter name)

## Configuration

Copy `.env.example` to `.env` and fill in:

| Variable              | Purpose                                  |
|-----------------------|------------------------------------------|
| `WHATSAPP_GROUP_NAME` | Name of the WhatsApp group to monitor    |
| `AUTH_DIR`            | Directory for Baileys auth credentials   |
| `KAFKA_BROKERS`       | Comma-separated Kafka broker list        |
| `KAFKA_SCORE_TOPIC`   | Topic name for score messages            |
| `KAFKA_POLL_TOPIC`    | Topic name for poll messages             |

## Scripts

```bash
npm run dev     # run with tsx watch
npm run build   # compile TypeScript to dist/
npm start       # run compiled output
```

## First-run pairing

On first start the process prints a QR code to the terminal. Scan it from WhatsApp on your phone (Linked Devices) to link the account. Credentials persist in `AUTH_DIR` and are reused on subsequent starts.

## Docker

```bash
docker build -t footie/whatsapp-monitor .
```

The image expects a volume mounted at `/data/auth` for persistent credentials.

## Kubernetes

Deployed via the Helm chart at the repo root (`helm/`). The chart provisions a PVC for `/data/auth` so credentials survive pod restarts.

On my Mac, I'm using Orbstack. So the persistence volumes are tied to this implementation, Change them if you use mini kube on run on the cloud (otherwise the pods will fail to claim)

## Testing locally.

I've been testing this locally and connecting to the services via local host. 
