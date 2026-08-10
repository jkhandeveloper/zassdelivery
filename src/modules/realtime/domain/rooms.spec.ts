import { parseRoom, Rooms } from './rooms';

describe('Rooms', () => {
  it('namespaces every room by kind, so ids from different tables cannot collide', () => {
    expect(Rooms.user('abc')).toBe('user:abc');
    expect(Rooms.order('abc')).toBe('order:abc');
    expect(Rooms.restaurant('abc')).toBe('restaurant:abc');
    expect(Rooms.rider('abc')).toBe('rider:abc');
  });

  it('gives the dispatch board a single fixed room', () => {
    expect(Rooms.dispatch()).toBe('dispatch');
  });

  it('never produces the same name for two different kinds of the same id', () => {
    const names = new Set([
      Rooms.user('same'),
      Rooms.order('same'),
      Rooms.restaurant('same'),
      Rooms.rider('same'),
    ]);

    expect(names.size).toBe(4);
  });
});

describe('parseRoom', () => {
  it('reads a room back into its parts', () => {
    expect(parseRoom('order:cmsd123')).toEqual({ kind: 'order', id: 'cmsd123' });
    expect(parseRoom('rider:driver-1')).toEqual({ kind: 'rider', id: 'driver-1' });
  });

  it('recognises the dispatch board, which carries no id', () => {
    expect(parseRoom('dispatch')).toEqual({ kind: 'dispatch', id: null });
  });

  it('rejects a kind it does not know', () => {
    expect(parseRoom('admin:everything')).toBeNull();
  });

  it('rejects a room with no id', () => {
    expect(parseRoom('order:')).toBeNull();
    expect(parseRoom('order')).toBeNull();
  });

  it('round-trips every room the app builds', () => {
    expect(parseRoom(Rooms.order('o1'))).toEqual({ kind: 'order', id: 'o1' });
    expect(parseRoom(Rooms.user('u1'))).toEqual({ kind: 'user', id: 'u1' });
    expect(parseRoom(Rooms.restaurant('r1'))).toEqual({ kind: 'restaurant', id: 'r1' });
    expect(parseRoom(Rooms.rider('d1'))).toEqual({ kind: 'rider', id: 'd1' });
    expect(parseRoom(Rooms.dispatch())).toEqual({ kind: 'dispatch', id: null });
  });
});
