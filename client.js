module.exports = function(user) {
  var socket = io('/presents');
  socket.emit('identify', user);

  return {
    socket: socket,
    join: function(room, fn) {
      socket.emit('join', { user_id: user.id, room: room }, fn);
    },
    leave: function(room, fn) {
      socket.emit('leave', { user_id: user.id, room: room }, fn);
    }
  }
}
