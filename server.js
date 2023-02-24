// Import necessary packages
const express = require('express');
const bodyParser = require('body-parser');
const multer = require('multer');
const sharp = require('sharp');
const AWS = require('aws-sdk');

// Set up AWS credentials and region
const STS = new AWS.STS();
const REGION = 'US East (N. Virginia) us-east-1';
const ROLE_ARN = 'arn:aws:iam::714451207725:role/LabRole';

// Set up an STS client and assume the role
async function assumeRole() {
  const params = {
    RoleArn: ROLE_ARN,
    RoleSessionName: 'my-s3-session'
  };

  const stsResponse = await STS.assumeRole(params).promise();
  const { AccessKeyId, SecretAccessKey, SessionToken } = stsResponse.Credentials;

  // Configure AWS SDK with the temporary credentials
  const credentials = new AWS.Credentials({
    accessKeyId: AccessKeyId,
    secretAccessKey: SecretAccessKey,
    sessionToken: SessionToken
  });
  AWS.config.update({ credentials, region: REGION });

  return true;
}

// Create an S3 object
const s3 = new AWS.S3();

// Create a DynamoDB object
const dynamodb = new AWS.DynamoDB();

// Create an Express app
const app = express();

// Set up multer to handle file uploads and sharp to create thumbnails
const upload = multer({ dest: 'uploads/' });

const createThumbnail = async (file) => {
  const thumbnail = await sharp(file.path).resize(200, 200).toBuffer();
  return {
    data: thumbnail,
    contentType: 'image/jpeg',
  };
};

// Define the route to handle file uploads
app.post('/upload', upload.single('image'), async (req, res) => {
  try {
    // Assume the Lab Role
    await assumeRole();

    // Create a unique file name
    const filename = `${Date.now()}-${req.file.originalname}`;

    // Create a thumbnail
    const thumbnail = await createThumbnail(req.file);

    // Upload the original image to S3
    const originalImageParams = {
      Bucket: 'reportbucket85456',
      Key: `originals/${filename}`,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
    };
    await s3.upload(originalImageParams).promise();

    // Upload the thumbnail to S3
    const thumbnailParams = {
      Bucket: 'reportbucket85456',
      Key: `thumbnails/${filename}`,
      Body: thumbnail.data,
      ContentType: thumbnail.contentType,
    };
    await s3.upload(thumbnailParams).promise();

    // Add the image metadata to DynamoDB
    const metadata = {
      id: Date.now().toString(),
      originalImageUrl: `https://reportbucket85456.s3.amazonaws.com/originals/${filename}`,
      thumbnailUrl: `https://reportbucket85456.s3.amazonaws.com/thumbnails/${filename}`,
      createdAt: new Date().toISOString(),
    };
    const dynamoParams = {
      TableName: 'YOUR_DYNAMODB_TABLE_NAME',
      Item: AWS.DynamoDB.Converter.marshall(metadata),
    };
    await dynamodb.putItem(dynamoParams).promise();

    res.status(200).send('Image uploaded successfully');
  } catch (error) {
    console.log(error);
    res.status(500).send('Error uploading image');
  }
});

// Start the server
app.listen(3000, () => {
  console.log('Server started');
});
