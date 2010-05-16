HOST = null; // localhost
PORT = 8001;

var fu = require("./fu"),
    sys = require("sys"),
    url = require("url"),
    qs = require("querystring"),
    template = require("./template");
    

var MESSAGE_BACKLOG = 200,
    SESSION_TIMEOUT = 60 * 1000;

var channel = new function () {
  var messages = [],
      callbacks = [];

  this.appendMessage = function (nick, room, type, text) {
    var m = { nick: nick
            , type: type // "msg", "join", "part"
            , text: text
            , room: room
            , timestamp: (new Date()).getTime()
            };

    switch (type) {
      case "msg":
        sys.puts("<" + nick + "> in " + room + " " + text);
        break;
      case "join":
        sys.puts(nick + " joined " + room);
        break;
      case "part":
        sys.puts(nick + " left " + room);
        break;
    }

    messages.push( m );

    while (callbacks.length > 0) {
      callbacks.shift().callback([m]);
    }

    while (messages.length > MESSAGE_BACKLOG)
      messages.shift();
  };

  this.query = function (room, since, callback) {
    var matching = [];
    for (var i = 0; i < messages.length; i++) {
      var message = messages[i];
      if (message.timestamp > since && room == message.room) {
        matching.push(message)
      }
    }

    if (matching.length != 0) {
      callback(matching);
    } else {
      callbacks.push({ timestamp: new Date(), callback: callback });
    }
  };

  // clear old callbacks
  // they can hang around for at most 30 seconds.
  setInterval(function () {
    var now = new Date();
    while (callbacks.length > 0 && now - callbacks[0].timestamp > 30*1000) {
      callbacks.shift().callback([]);
    }
  }, 3000);
};

var sessions = {};

function createSession (nick, room) {
  if (nick.length > 50) return null;
  if (/[^\w_\-^!]/.exec(nick)) return null;

  for (var i in sessions) {
    var session = sessions[i];
    if (session && session.nick === nick && session.room === room) return null;
  }

  var session = { 
    nick: nick, 
    room: room, 
    id: Math.floor(Math.random()*99999999999).toString(),
    timestamp: new Date(),

    poke: function () {
      session.timestamp = new Date();
    },

    destroy: function () {
      channel.appendMessage(session.nick,session.room, "part");
      delete sessions[session.id];
    }
  };

  sessions[session.id] = session;
  return session;
}

// interval to kill off old sessions
setInterval(function () {
  var now = new Date();
  for (var id in sessions) {
    if (!sessions.hasOwnProperty(id)) continue;
    var session = sessions[id];

    if (now - session.timestamp > SESSION_TIMEOUT) {
      session.destroy();
    }
  }
}, 1000);

fu.listen(PORT, HOST);

fu.get("/", fu.staticHandler("index.html"));
fu.get("/style.css", fu.staticHandler("style.css"));
fu.get("/client.js", fu.staticHandler("client.js"));
fu.get("/jquery-1.2.6.min.js", fu.staticHandler("jquery-1.2.6.min.js"));

fu.get("/entry", function (req, res) {
   // r = room
   var r = qs.parse(url.parse(req.url).query).r;
   res.writeHead(200, {'Content-Type': 'text/html'});

   if (r == undefined) r = 'default';

   var tmpl = template.create(require('fs').readFileSync('index.tmpl.html'),{room:r});
   res.end(tmpl);
});


fu.get("/who", function (req, res) {
  var nicks = [];
  var room = qs.parse(url.parse(req.url).query).room;
  for (var id in sessions) {
    if (!sessions.hasOwnProperty(id)) continue;
    if (session.room == room) {
      var session = sessions[id];
      nicks.push(session.nick);
    }
  }
  res.simpleJSON(200, { nicks: nicks });
});

fu.get("/join", function (req, res) {
  var nick = qs.parse(url.parse(req.url).query).nick;
  var room = qs.parse(url.parse(req.url).query).room;
  if (nick == null || nick.length == 0) {
    res.simpleJSON(400, {error: "Bad nick."});
    return;
  }
  if (room== null || room.length == 0) {
    res.simpleJSON(400, {error: "Bad room."});
    return;
  }

  var session = createSession(nick,room);
  if (session == null) {
    res.simpleJSON(400, {error: "Nick in use"});
    return;
  }

  //sys.puts("connection: " + nick + "@" + res.connection.remoteAddress);

  channel.appendMessage(session.nick, session.room, "join");
  res.simpleJSON(200, { id: session.id, nick: session.nick});
});

fu.get("/part", function (req, res) {
  var id = qs.parse(url.parse(req.url).query).id;
  var session;
  if (id && sessions[id]) {
    session = sessions[id];
    session.destroy();
  }
  res.simpleJSON(200, { });
});

fu.get("/recv", function (req, res) {
  if (!qs.parse(url.parse(req.url).query).since) {
    res.simpleJSON(400, { error: "Must supply since parameter" });
    return;
  }

  var id = qs.parse(url.parse(req.url).query).id;
  var session;
  var room = qs.parse(url.parse(req.url).query).room;
  if (id && sessions[id]) {
    session = sessions[id];
    session.poke();
    sys.puts (session.nick + " asked for messages in " + room);
  }

  var since = parseInt(qs.parse(url.parse(req.url).query).since, 10);

  channel.query(room, since, function (messages) {
    if (session) session.poke();
    var matching = [];

    for (var i = 0; i < messages.length; i++) {
      var message = messages[i];
      if (message.room == room) {
        matching.push(message)
      }
    }
    res.simpleJSON(200, { messages: matching});
  });
});

fu.get("/send", function (req, res) {
  var id = qs.parse(url.parse(req.url).query).id;
  var text = qs.parse(url.parse(req.url).query).text;
  var room = qs.parse(url.parse(req.url).query).room;

  var session = sessions[id];
  if (!session || !text) {
    res.simpleJSON(400, { error: "No such session id" });
    return; 
  }

  session.poke();

  channel.appendMessage(session.nick,room, "msg", text);
  res.simpleJSON(200, {});
});