const AWS = require("aws-sdk");
require("dotenv").config();

async function getPollyUsage() {
  // Configure AWS
  AWS.config.update({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION || "us-east-1",
  });

  const cloudwatch = new AWS.CloudWatch();
  const startTime = new Date();
  startTime.setDate(startTime.getDate() - 30); // Last 30 days

  try {
    const data = await cloudwatch
      .getMetricStatistics({
        Namespace: "AWS/Polly",
        MetricName: "CharactersSucceeded",
        Dimensions: [{ Name: "Operation", Value: "SynthesizeSpeech" }],
        StartTime: startTime,
        EndTime: new Date(),
        Period: 86400, // 1 day in seconds
        Statistics: ["Sum"],
      })
      .promise();

    console.log("Polly usage over last 30 days:");
    console.log(data.Datapoints.sort((a, b) => a.Timestamp - b.Timestamp));

    const totalChars = data.Datapoints.reduce(
      (sum, point) => sum + point.Sum,
      0
    );
    console.log(`Total characters processed: ${totalChars}`);
    console.log(
      `Estimated cost (after free tier): $${(
        ((totalChars - 1000000) / 1000000) *
        4
      ).toFixed(2)} USD`
    );

    return data;
  } catch (error) {
    console.error("Error fetching Polly usage:", error);
  }
}

getPollyUsage();
