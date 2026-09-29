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
