// Engine bindings — foreign static methods available to all scripts.
class Engine {
    foreign static get_position(entity_id)
    foreign static set_position(entity_id, x, y, z)
    foreign static get_facing(entity_id)
    foreign static set_facing(entity_id, dir)
    foreign static is_key_down(key_code)
    foreign static play_sound(sound_name)
    foreign static get_flag(name)
    foreign static set_flag(name, value)
    foreign static get_dt()
    foreign static log(message)
    foreign static player_id()
    foreign static npc_ids()
    foreign static get_time_of_day()
    foreign static set_time_of_day(time)
}
