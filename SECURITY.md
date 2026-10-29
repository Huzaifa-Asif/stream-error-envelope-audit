# Security policy

## Supported version

The latest released major version receives security fixes.

## Reporting

Report vulnerabilities privately through GitHub Security Advisories for `Huzaifa-Asif/stream-error-envelope-audit`. Do not open a public issue containing credentials, sensitive error bodies, or exploit details.

The package does not make untrusted values safe for logging. It copies only bounded code/type/message fields, but callers should redact secrets before observation.
