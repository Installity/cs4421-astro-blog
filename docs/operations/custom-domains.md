# Custom domain cutover

## Addresses and prerequisites

| Purpose | Address |
| --- | --- |
| Static CloudFront address | https://d2lpj15qx37gqq.cloudfront.net |
| Static custom target | https://andreitrn.me |
| ECS HTTPS load-balancer endpoint | https://as-2b62f684bea24081892fa30f44c134ca.ecs.us-east-1.on.aws |
| ECS custom target | https://ssr.andreitrn.me |

The AWS addresses remain available. Custom targets need completed TLS, routing
and DNS setup; a successful local build or PR is not evidence that they are live.

CloudFront imports ACM certificate
`arn:aws:acm:us-east-1:873716897321:certificate/04280730-f6e2-44a4-8f3a-0a52123b505f`,
covering `andreitrn.me` and `www.andreitrn.me`. It must be **Issued** before merging
this configuration for deployment. Keep both ACM validation CNAMEs at Namecheap
so ACM can renew it. CloudFront certificates must be in us-east-1.
[AWS certificate requirements](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cnames-and-https-requirements.html).

This certificate does not cover `ssr.andreitrn.me`. Request a separate public,
DNS-validated ACM certificate for that name in the ALB region, us-east-1. Add its
unique validation CNAME at Namecheap and wait for Issued. Certificate request and
validation are external prerequisites; this PR does not create or validate it.

## Configure the ECS hostname before cutover

Follow the [AWS Express custom-domain procedure](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/express-service-advanced-customization.html).
In ECS default/astro-blog, open Resources and follow the existing HTTPS listener
rule to the Application Load Balancer. Add `ssr.andreitrn.me` as an OR value in its
existing Host-header condition, keeping the AWS application hostname and every
other condition/action. Attach the issued SSR certificate as an additional SNI
certificate on that HTTPS listener; retain existing certificates.

Use the existing rule rather than a new rule with copied target groups: Express
updates its forwarding weights during canary releases. Record the actual listener,
rule and certificate identifiers after review. These managed ALB resources are
outside the static CDK stack; the PR does not claim to own or apply their changes.

Read-only inventory on 28 October 2026 found HTTPS listener suffix
`d9bb7441277141b6` and the application host rule at priority `44990`, suffix
`d4733e42d9266e82`. Re-read Resources before editing: managed resources can change.
The current rule has only the existing AWS application hostname as its condition.

In Namecheap Advanced DNS, add a CNAME for the `ssr` host to:

```text
ecs-express-gateway-alb-d8589443-625676614.us-east-1.elb.amazonaws.com
```

This is the actual ALB DNS name verified on 28 October 2026; confirm it still
matches Resources, replacing only conflicting records for `ssr`.
It is different from the ECS application hostname listed above. Retain the
certificate-validation and email records. Verify HTTPS, /api/health and /api/news
on ssr.andreitrn.me before relying on its canonical/feed URLs or submitting it.

## Deploy the reviewed changes

1. Review the CloudFront/certificate changes with CDK diff. Preserve the existing
   bucket, distribution and function identities; investigate any replacement.
2. Merge after required CI and human review, and after the certificate prerequisites
   above. Main triggers static CDK deployment and the separate tested ECS release.
3. Wait for **both** workflows: static delivery configures aliases, certificate,
   HTTPS and www redirect; ECS delivery preserves configuration and adds both
   custom static origins to the existing CloudFront CORS allowlist.
4. Require the main ECS verification to pass for each of the three origins. It
   sends one Origin per request, not the whole comma-separated environment value.

The static build uses andreitrn.me for canonical, RSS and sitemap URLs. The Node
build defaults to ssr.andreitrn.me. PUBLIC_SITE_URL can override build defaults;
use the matching host when rebuilding either output. The static news endpoint
remains the working AWS URL while DNS is being configured. After the SSR address
passes HTTPS and CORS checks, set the repository Actions variable
PUBLIC_NEWS_API_URL to https://ssr.andreitrn.me/api/news and rebuild/redeploy static
assets. This keeps news available before the API hostname cutover.

## Point the static names to CloudFront

Only after CloudFront reports Deployed and ECS CORS verification passes, change
Namecheap Advanced DNS Host Records:

| Type | Host | Value | TTL |
| --- | --- | --- | --- |
| ALIAS | @ | d2lpj15qx37gqq.cloudfront.net | 5 min |
| CNAME | www | d2lpj15qx37gqq.cloudfront.net | Automatic |

Replace conflicting parking A/AAAA/redirect/CNAME entries for those exact hosts.
Retain ACM underscore validation records, MX and other unrelated records. Enter
DNS hostnames without https:// or paths. Keep the existing Namecheap nameservers.
[Namecheap ALIAS instructions](https://www.namecheap.com/support/knowledgebase/article.aspx/10128/2237/how-to-create-an-alias-record/).

## Verify and recover

After propagation, check all four assessment addresses. Static root, /blog/ and an
article must serve over valid HTTPS; HTTP must redirect to HTTPS; www must redirect
to the same path/query on the root domain. Check a real browser news load and
refresh from the custom static domain, including its cross-origin API request.
Inspect generated canonical links, rss.xml, sitemap-index.xml and the linked
sitemap for the appropriate static/server hostname. Check ssr /api/health JSON,
nonempty news and the running image identity separately from static availability.

A container rollback does not undo static DNS or CloudFront configuration. A full
ongoing rollback to a pre-domain source revision can also restore an old CORS
allowlist. Inspect its runtime configuration during preparation; image-only
restore-image preserves the current allowlist. After any recovery verify news
from the custom root and original CloudFront origin, as well as health. The
rollback helper now checks all three static origins and fails verification if an
old source revision restores an allowlist that no longer serves the custom site.

If custom-domain setup fails, use the retained AWS addresses while fixing the
certificate, rule or DNS issue. Reverting this PR removes the custom CloudFront
aliases/certificate and redirect; move public DNS away from those aliases first
so rollback does not leave custom hostnames pointing to an unconfigured viewer.
Do not remove ACM validation records simply to reverse website traffic routing.
