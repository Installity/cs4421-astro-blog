import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { Construct } from 'constructs';

export interface StaticSiteStackProps extends cdk.StackProps {
  // The test suite supplies a small fixture; deployments use Astro's dist directory.
  sitePath?: string;
}

export class StaticSiteStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: StaticSiteStackProps = {}) {
    super(scope, id, props);

    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Astro builds directory routes as /blog/post/index.html. S3 origins do not
    // automatically resolve these paths, so rewrite viewer requests before caching.
    const directoryIndex = new cloudfront.Function(this, 'DirectoryIndex', {
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (uri.endsWith('/')) {
    request.uri += 'index.html';
  } else if (!uri.split('/').pop().includes('.')) {
    request.uri += '/index.html';
  }
  return request;
}
      `),
    });

    const distribution = new cloudfront.Distribution(this, 'SiteDistribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        compress: true,
        functionAssociations: [{
          function: directoryIndex,
          eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
        }],
      },
      defaultRootObject: 'index.html',
    });

    // Use a separate, generated name: the existing deployment Lambda already
    // created its default log group outside CloudFormation in older deployments.
    const deploymentLogs = new logs.LogGroup(this, 'SiteDeploymentLogs', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    new s3deploy.BucketDeployment(this, 'DeploySite', {
      logGroup: deploymentLogs,
      sources: [s3deploy.Source.asset(props.sitePath ?? path.resolve(__dirname, '../../dist'))],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ['/*'],
      prune: true,
      retainOnDelete: true,
    });

    new cdk.CfnOutput(this, 'SiteUrl', {
      value: `https://${distribution.distributionDomainName}`,
      description: 'HTTPS URL of the Astro blog',
    });
  }
}
