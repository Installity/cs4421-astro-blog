import * as path from 'node:path';
import * as vm from 'node:vm';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { StaticSiteStack } from '../lib/cdk-stack';

const app = new cdk.App();
const stack = new StaticSiteStack(app, 'TestStaticSite', {
  sitePath: path.join(__dirname, 'site'),
});
const template = Template.fromStack(stack);

test('keeps site files private and retained if the stack is removed', () => {
  template.hasResource('AWS::S3::Bucket', {
    DeletionPolicy: 'Retain',
    Properties: {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    },
  });
  template.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1);
});

test('routes HTTPS requests to the private origin and invalidates on deployment', () => {
  template.hasResourceProperties('AWS::CloudFront::Distribution', {
    DistributionConfig: {
      DefaultRootObject: 'index.html',
      DefaultCacheBehavior: {
        ViewerProtocolPolicy: 'redirect-to-https',
        FunctionAssociations: [{ EventType: 'viewer-request' }],
      },
    },
  });
  template.hasResourceProperties('Custom::CDKBucketDeployment', {
    DistributionPaths: ['/*'],
  });
});

test('attaches the existing us-east-1 certificate and both static domain names', () => {
  template.hasResourceProperties('AWS::CloudFront::Distribution', {
    DistributionConfig: {
      Aliases: ['andreitrn.me', 'www.andreitrn.me'],
      ViewerCertificate: {
        AcmCertificateArn: 'arn:aws:acm:us-east-1:873716897321:certificate/04280730-f6e2-44a4-8f3a-0a52123b505f',
        SslSupportMethod: 'sni-only',
        MinimumProtocolVersion: 'TLSv1.2_2021',
      },
    },
  });
  template.resourceCountIs('AWS::CertificateManager::Certificate', 0);
  template.hasOutput('SiteUrl', {});
  template.hasOutput('CustomSiteUrl', { Value: 'https://andreitrn.me' });
});

test('uses a separate managed log group without claiming the existing Lambda logs', () => {
  template.resourceCountIs('AWS::Logs::LogGroup', 1);
  const groups = template.findResources('AWS::Logs::LogGroup');
  const [logGroupId, logGroup] = Object.entries(groups)[0];
  expect(logGroup.Properties.LogGroupName).toBeUndefined();
  expect(logGroup.Properties.RetentionInDays).toBe(30);
  expect(logGroup.DeletionPolicy).toBe('Retain');
  template.hasResourceProperties('AWS::Lambda::Function', {
    LoggingConfig: { LogGroup: { Ref: logGroupId } },
  });
  expect(logGroupId).not.toMatch(/^CustomCDKBucketDeployment/);
});

test.each([
  ['/', '/index.html'],
  ['/blog/', '/blog/index.html'],
  ['/blog/first-post', '/blog/first-post/index.html'],
  ['/blog/first-post/', '/blog/first-post/index.html'],
  ['/_astro/site.css', '/_astro/site.css'],
])('rewrites %s to %s', (requestPath, expectedPath) => {
  const resources = template.findResources('AWS::CloudFront::Function');
  const functionResource = Object.values(resources)[0];
  const code = functionResource.Properties.FunctionCode as string;
  const context = vm.createContext({});
  vm.runInContext(`${code}\nresult = handler({ request: { uri: '${requestPath}' } });`, context);
  expect((context.result as { uri: string }).uri).toBe(expectedPath);
});

function viewerRequest(request: object) {
  const code = Object.values(template.findResources('AWS::CloudFront::Function'))[0]
    .Properties.FunctionCode as string;
  const context = vm.createContext({ request });
  vm.runInContext(`${code}\nresult = handler({ request });`, context);
  return context.result;
}

test.each(['/', '/blog/first-post/', '/_astro/site.css'])(
  'redirects www%s to the same public path on the canonical HTTPS host', (uri) => {
    const response = viewerRequest({ uri, headers: { host: { value: 'www.andreitrn.me' } }, querystring: {} });
    expect(response.statusCode).toBe(301);
    expect(response.headers.location.value).toBe(`https://andreitrn.me${uri}`);
  },
);

test('preserves encoded, empty and repeated query parameters in the www redirect', () => {
  const response = viewerRequest({
    uri: '/news/', headers: { host: { value: 'www.andreitrn.me' } },
    querystring: { q: { value: 'a%20b%26c' }, empty: { value: '' },
      tag: { value: 'first', multiValue: [{ value: 'first' }, { value: 'second' }] } },
  });
  expect(response.headers.location.value).toBe('https://andreitrn.me/news/?q=a%20b%26c&empty=&tag=first&tag=second');
});

test.each(['andreitrn.me', 'd2lpj15qx37gqq.cloudfront.net'])(
  'continues serving directory routes on %s without redirecting', (host) => {
    const request = { uri: '/blog/', headers: { host: { value: host } }, querystring: {} };
    const result = viewerRequest(request);
    expect(result.uri).toBe('/blog/index.html');
    expect(result.statusCode).toBeUndefined();
  },
);
