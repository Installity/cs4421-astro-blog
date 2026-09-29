import * as cdk from "aws-cdk-lib/core";
import { StaticSiteStack } from "../lib/cdk-stack";

const app = new cdk.App();
new StaticSiteStack(app, "CdkStack", {


    // if env not specified it will be environment agnostic (the stack)

    env: { account: '873716897321', region: 'us-east-1'},
} );