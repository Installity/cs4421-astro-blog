# Astro blog static site infrastructure

This AWS CDK app defines the Week 4 static site: a private S3 bucket, a
CloudFront distribution with origin access control, and a BucketDeployment that
uploads the Astro build and invalidates `/*` after each deployment. A CloudFront
Function maps routes such as `/blog/first-post/` to the corresponding
`index.html` object in S3.

## Validate locally

Run these commands from the repository root:

```sh
npm ci
npm run build
npm ci --prefix cdk
npm run build --prefix cdk
npm test --prefix cdk -- --runInBand
cdk synth
```

The root build must run before CDK synthesis because the stack packages
`../dist` as its deployment asset. The CDK tests use a small fixture so they can
run independently of a full Astro build. CI performs all of these checks on PRs.

The CDK CLI needs AWS credentials for the target account. This project uses the
local AWS CLI profile `blog-user`; authenticate it first, then run CDK with
that profile:

```sh
aws sts get-caller-identity --profile blog-user
AWS_PROFILE=blog-user cdk diff
AWS_PROFILE=blog-user cdk deploy
```

If your credentials use a different profile, replace `blog-user` with that
profile name. You can also run the commands from `cdk/` with `npx cdk` after
exporting `AWS_PROFILE`.

## Deploy later

Deployment requires an AWS account with CDK bootstrap completed and appropriate
permissions. Review `cdk diff` before deploying. No credentials are stored in
this repository. This branch only defines and validates the stack; it does not
deploy it.

The S3 bucket is retained if the stack is deleted, so removing the stack does
not delete the site files. Plan to clean up retained resources separately when
the coursework is finished. CloudFront's default domain uses its default TLS
certificate; a custom certificate and domain would need an explicit TLS policy.
