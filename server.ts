import {
  Application,
  Context,
  Router,
  send,
} from "https://deno.land/x/oak@v12.6.1/mod.ts"; //Servidor
import { Session } from "https://deno.land/x/oak_sessions@v4.0.5/mod.ts";
import { OAuth2Client } from "https://deno.land/x/oauth2_client@v1.0.2/mod.ts";
import { DB } from "https://deno.land/x/sqlite@v3.8/mod.ts"; //database

const oauth2Client = new OAuth2Client({
  clientId:
    "38057856247-sh5mjb39qop277fcgisa9c2sq2nioofd.apps.googleusercontent.com", // Substitua pelo ID do cliente do Google
  clientSecret: "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", // Substitua pelo segredo do cliente do Google
  authorizationEndpointUri: "https://accounts.google.com/o/oauth2/v2/auth", // Endpoint de autorização do Google
  tokenUri: "https://oauth2.googleapis.com/token", // Endpoint de token do Google
  redirectUri: "http://localhost:8080/oauth2/callback", // URL de redirecionamento do seu aplicativo
  defaults: {
    scope: ["email", "profile", "https://www.googleapis.com/auth/contacts"], // Escopos necessários para o login com o Google
  },
});
const db = new DB("./database/data.db");

interface CustomContext extends Context {
  error: (message: string, error: Error) => void;
}

type AppState = {
  session: Session;
  informacaoExtra: string;
};

function DBData(data: Record<string, string>) {
  switch (data.type) {
    case "CREATE":
      db.query(`INSERT INTO ${data.target} (name, creation) VALUES (?, ?)`, [
        data.value,
        data.date,
      ]);
      break;
    case "DELETE":
      db.execute(`DELETE FROM ${data.target} WHERE id = ${data.id};`);
      break;
    case "EDIT":
      db.query(`UPDATE ${data.target} SET ${data.column} = ? WHERE id = ?`, [
        data.value,
        data.id,
      ]); //corrigir bugs e adicionar mais configurações
      break;
  }
}
//corrigir bugs
function sendData(c: CustomContext) {
  return async function () {
    const body = c.request.body();
    if (body.type === "json") {
      const data = await body.value;
      try {
        DBData(data);
        c.response.body = { message: "Dados recebidos com sucesso! :)" };
      } catch (error) {
        c.error("Erro ao executar a consulta SQL:", error);
        c.response.body = {
          message: "Erro ao inserir dados no banco de dados",
        };
      }
    } else {
      c.response.status = 400;
      c.response.body = { message: "ooops, parece que algo deu errado! :(" };
    }
  };
}

const router = new Router<AppState>();
router
  .get("/", async (ctx) => {
    const tokens = ctx.state.session.get("tokens") as
      | { accessToken: string }
      | undefined;
    if (tokens) {
      //descobrir forma de enviar para o cliente
      const userResponse = await fetch(
        "https://www.googleapis.com/oauth2/v2/userinfo",
        {
          headers: {
            Authorization: `Bearer ${tokens.accessToken}`,
          },
        },
      );
      const userData = await userResponse.json();
      /*const contactsResponse = await fetch(
        "https://people.googleapis.com/v1/people/me/connections?personFields=emailAddresses",
        {
          headers: {
            Authorization: `Bearer ${tokens.accessToken}`,
          },
        },
      );
      const contactsData = await contactsResponse.json();<--lidar com essa informação na database no server-side*/
      //send
      const file = await Deno.readFile("./public/index.html");
      let html = new TextDecoder().decode(file);
      html = html.replace("<userData/>", `<script>const userData = ${JSON.stringify(userData)}</script>`); //tentar criar uma função para lidar com html personalizado
      ctx.response.headers.set("Content-Type", "text/html");
      ctx.response.body = html;
    } else {
      ctx.response.redirect("/login");
    }
  })
  .get("/login", async (ctx) => {
    // Construir a URL para o redirecionamento de autorização e obter um codeVerifier
    const { uri, codeVerifier } = await oauth2Client.code.getAuthorizationUri();

    // Armazenar o codeVerifier na sessão do usuário
    ctx.state.session.flash("codeVerifier", codeVerifier);

    // Redirecionar o usuário para o endpoint de autorização
    ctx.response.redirect(uri);
  })
  .get("/oauth2/callback", async (ctx) => {
    // Verificar se o codeVerifier está presente na sessão do usuário
    const codeVerifier = ctx.state.session.get("codeVerifier");
    if (typeof codeVerifier !== "string") {
      throw new Error("Código de verificação inválido");
    }

    // Trocar o código de autorização por um token de acesso
    const tokens = await oauth2Client.code.getToken(ctx.request.url, {
      codeVerifier,
    });
    ctx.state.session.flash("tokens", tokens);

    ctx.response.redirect("/");
  })
  .post("/enviar", async (ctx) => await sendData(ctx)())
  .get(
    "/receber",
    (ctx) =>
      ctx.response.body = {
        chats: db.query("SELECT name, id, img FROM chats"),
      },
  )
  .get("/:item", async (ctx) => {
    try {
      const filePath = `./public/pages/${ctx.params.item}.html`.replace(
        /\\/g,
        "/",
      );
      await send(ctx, filePath);
    } catch (error) {
      try {
        const fileContent = await Deno.readTextFile(
          `./view/err/${error.status}.html`,
        );
        ctx.response.body = fileContent;
      } catch (error) {
        ctx.response.body =
          `<html><head><title>${error.status}</title></head><body><h1>${error.status}</h1></body></html>`;
      }
      ctx.response.status = error.status;
    }
  })
  .get("/:folder/:item", async (ctx) => {
    if (ctx.request.headers.get("Referer")?.includes("http://")) {
      try {
        await send(ctx, `./public/${ctx.params.folder}/${ctx.params.item}`);
      } catch (error) {
        ctx.response.status = error.status;
      }
    } else {
      ctx.response.status = 403;
      const fileContent = await Deno.readTextFile("./view/err/403.html");
      ctx.response.body = fileContent;
    }
  });

const app = new Application<AppState>();

app
  .use(Session.initMiddleware())
  .use(router.allowedMethods(), router.routes());

console.log(`HTTP server running. Access it at: http://localhost:8080/`);
await app.listen({ port: 8080 });
