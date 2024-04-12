import { Client } from "discord.js";
import dotenv from "dotenv";
dotenv.config();
const REQUEST_PASSWORD: string = process.env.REQUEST_PASSWORD ?? '';


import http from "http";
import { Servers } from "./dbObject.js";
import { DATA } from "./types.js";

export default class HttpServer {
  private server: http.Server;
  private client: Client;

  private async notice(data: string) {
    await Servers.sync();
    const servers: DATA[] = await Servers.findAll();
    for (const server of servers) {
      const ttsChannel = server.dataValues.ttsChannel;
      // if(ttsChannel && server.dataValues.id == '1215573434159996948') {
      if(ttsChannel) {
        this.client.channels.fetch(ttsChannel).then(channel => {
          if(channel?.isTextBased()){
            try {
              channel.send(data);
            } catch (error) {
              console.log(error);
            }
          }
        });
      }
    }
  }

  private requestHandler = (req: http.IncomingMessage, res: http.ServerResponse) => {
    if (req.url === "/notice" && req.method === "POST") {
      let postData: string = "";
      req.on("data", (data) => {
        postData += typeof data === "string" ? data : data.toString();
      });
      req.on("end", async () => {
        const password = postData.split(",")[0];
        postData = postData.split(",")[1];
        if (password.startsWith("password=") && password.split("=")[1] === REQUEST_PASSWORD) {
          await this.notice(postData);
        }
        res.writeHead(200, { "Content-Type": "text/html" });
        res.write("OK");
        res.end();
      });
    }
    else {
      res.writeHead(404, { "Content-Type": "text/html" });
      res.write("<h1>404 Not Found</h1>");
      res.end();
    }
  }

  constructor(client: Client) {
    this.server = http.createServer(this.requestHandler);
    this.client = client;
  }

  start() {
    this.server.listen(8080, () => {
      console.log("Server is running on 8080 port");
    });
  }

  stop() {
    this.server.close(() => {
      console.log("Server is closed");
    });
  }
}
