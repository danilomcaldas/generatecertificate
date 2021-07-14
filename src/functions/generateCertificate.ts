import handlebars from "handlebars";
import chromium from "chrome-aws-lambda";
import path from "path";

import fs from "fs";
import dayjs from "dayjs";

import {S3} from 'aws-sdk';

import { document } from "../utils/dynamodbClient";
import { ICreateCertificate } from "../dto/ICreateCertificate";
import { ITemplateCertificate } from "src/dto/ITemplateCertificate";

export const handle = async (event) => {
  const { name, id, grade } = JSON.parse(event.body) as ICreateCertificate;

  const response = await document.query({
    TableName : "users_certificates",
        KeyConditionExpression : "id = :id",
        ExpressionAttributeValues : {
            ":id":id
        }
  }).promise()

  const userAlreadyExists = response.Items[0]

  if(!userAlreadyExists){
    await document
    .put({
      TableName: "users_certificates",
      Item: {
        id,
        name,
        grade,
      },
    })
    .promise();
  }

  const compile = async function (data: ITemplateCertificate) {
    const filePath = path.join(
      process.cwd(),
      "src",
      "templates",
      "certificate.hbs"
    );

    const html = fs.readFileSync(filePath, "utf-8");

    return handlebars.compile(html)(data);
  };

  const medalPath = path.join(process.cwd(), "src", "templates", "selo.png");
  const medal = fs.readFileSync(medalPath, "base64");

  const data: ITemplateCertificate = {
    date: dayjs().format("DD/MM/YYYY"),
    grade,
    name,
    id,
    medal,
  };

  const content = await compile(data);

  const browser = await chromium.puppeteer.launch({
    headless: true,
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath,
  });

  const page = await browser.newPage();

  await page.setContent(content);

  const pdf = await page.pdf({
    format: "a4",
    landscape: true,
    path : process.env.IS_OFFLINE ? "certificate.pdf" : null,
    printBackground: true,
    preferCSSPageSize: true,
  });

  await browser.close();

  const s3 = new S3();

  await s3.putObject({
    Bucket : "rentx-api-inilo",
    Key : `${id}.pdf`,
    ACL: "public-read",
    Body : pdf,
    ContentType : "application/pdf"
  }).promise()

  return {
    statusCode: 201,
    body: JSON.stringify({
      message: `https://rentx-api-inilo.s3.amazonaws.com/${id}.pdf`,
    }),
    headers: {
      contentType: "application/json",
    },
  };
};
