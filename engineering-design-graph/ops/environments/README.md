# Environment overlay patches

`../k8s.yaml` is the neutral deployment template. `dev.patch.yaml` and `prod.patch.yaml` are environment-specific strategic-merge-style patches that document only the intentional differences from that base.

These files do not contain credentials. Supply database/OIDC/broker/telemetry secrets through the deployment platform, preferably mounted files and the supported `*_FILE` variables where applicable.

## Development

- 1 replica
- in-memory rate limit backend
- relaxed example request limit
- slower outbox polling
- lower CPU/memory requests and limits

## Production example

- 2 replicas
- PostgreSQL distributed rate limit backend
- default request limit and outbox interval
- higher resource requests and limits

The production values are deployment defaults, not SLO commitments. Review replica count, resources, request limits, broker settings and telemetry endpoints for each environment before rollout.
