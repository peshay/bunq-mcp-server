# Security Policy

## Supported Versions
The `main` branch is the only actively supported line at the moment.

## Reporting a Vulnerability
Please do not open public issues for security vulnerabilities.

Report privately by email to the project maintainer and include:
- affected component/tool
- impact and attack scenario
- reproduction steps
- suggested mitigation if available

You will receive an acknowledgement as soon as possible and we will coordinate remediation and disclosure timing.

## Hardening Notes
- `ENABLE_PAYMENTS=false` by default.
- Do not expose webhook endpoints without network controls and shared secret validation.
- Rotate bunq credentials immediately if compromise is suspected.
