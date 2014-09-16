// track users + rooms

// uid -> user: redis hash
// rooms:uid: redis set
// uid -> timeout: obj

var Promise = require('bluebird');
var redis = require('redis');

Promise.promisifyAll(redis);

function Presents(io, redisOptions) {
  this.timeouts = {};
  this.redis = redis.createClient(redisOptions || {});
  this.io = io.of('/presents');
  this.io.on('connection', connect.bind(this));
}

function connect(socket) {
  Promise.promisifyAll(socket);
  console.log('connect', socket.id);
  socket.on('identify', identify.bind(this, socket));
  socket.on('join', join.bind(this, socket));
  socket.on('leave', leave.bind(this, socket));
  socket.on('disconnect', disconnect.bind(this, socket));
}

function identify(socket, user) {
  setUser.call(this, socket, user)
    .then(seen.bind(this, socket, user))
    .then(getRooms.bind(this, user.id))
    .map(function(room) {
      socket.join(room);
    })
    .catch(onError);
}

function join(socket, msg, ack) {
  var room = msg.room;
  getUser.call(this, msg.user_id)
    .then(associate.bind(this, socket, room))
    .then(getUsers.bind(this, room))
    .then(ack)
    .catch(onError);
}

function leave(socket, msg, ack) {
  var room = msg.room;
  getUser.call(this, msg.user_id)
    .then(disassociate.bind(this, socket, room))
    .then(getUsers.bind(this, room))
    .then(ack)
    .catch(onError);
}

function disconnect(socket) {
  console.log('disconnect', socket.id);
  this.timeouts[socket.id] = setTimeout(leaveAll.bind(this, socket), 5000);
}

function seen(socket, user) {
  console.log('seen user', user.id);
  var timeout = this.timeouts[user.id];
  if (timeout) {
    console.log('canceling disconnect timeout for user', user.id);
    clearTimeout(timeout);
    delete this.timeouts[user.id];
  }
  return user;
}

// helpers

function getUser(id) {
  return this.redis.hgetAsync('users', id)
    .bind(this)
    .then(function(json) {
      if (!json) {
        return this.redis.hkeysAsync('users')
          .then(function(user_ids) {
            throw new Error('user ' + id + ' not found, known user ids: ' + JSON.stringify(user_ids));
          });
      } else {
        return json;
      }
    })
    .then(JSON.parse);
}

function setUser(socket, user) {
  console.log('saving user', user);
  var json = JSON.stringify(user);
  return this.redis.hsetAsync('users', user.id, json).bind(this);
}

function associate(socket, room, user) {
  return Promise.join(
    this.redis.saddAsync('rooms:' + user.id, room),
    this.redis.saddAsync('users:' + room, user.id)
  ).bind(this).spread(function(added) {
    socket.join(room);
    if (added) socket.broadcast.to(room).emit('join', user);
  });
}

function disassociate(socket, room, user) {
  return Promise.join(
    this.redis.sremAsync('rooms:' + user.id, room),
    this.redis.sremAsync('users:' + room, user.id)
  ).bind(this).spread(function(removed) {
    if (removed) socket.broadcast.to(room).emit('leave', user);
  });
}

function getRooms(user_id) {
  return this.redis.smembersAsync('rooms:' + user_id).bind(this);
}

function getUsers(room) {
  return this.redis.smembersAsync('users:' + room)
    .bind(this)
    .then(function(ids) {
      return ids.length ? this.redis.hmgetAsync('users', ids) : [];
    })
    .map(JSON.parse);
}

function leaveAll(socket, uid) {
  console.log('leaving all rooms, socket.id', socket.id);
  var user;
  getUser.call(this, uid)
    .then(function(u) {
      user = u;
      delete this.timeouts[user.id];
      return getRooms.call(this, user.id);
    })
    .map(function(room) {
      return disassociate.call(this, socket, user, room);
    })
    .then(function() {
      return this.redis.hdelAsync('users', user.id);
    })
    .catch(onError);
}

function onError(err) {
  console.log(err.stack);
}

module.exports = {
  listen: function(server) {
    return new Presents(server);
  }
};

if (!module.parent) {
  var fs = require('fs');
  var app = function(req, res) {
    if (req.url === '/client.js') {
      fs.createReadStream('./client.build.js').pipe(res);
    } else {
      fs.createReadStream('./index.html').pipe(res);
    }
  };
  var server = require('http').createServer(app);
  var io = require('socket.io')(server);
  var presents = module.exports.listen(io);
  server.listen(3000);
}
