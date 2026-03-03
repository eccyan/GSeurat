import "./engine" for Engine

// Simple test script: logs a greeting once when a flag hasn't been set yet.
class NpcGreeting {
    static update(entity_id, dt) {
        var flag_name = "npc_%(entity_id)_greeted"
        if (!Engine.get_flag(flag_name)) {
            var pos = Engine.get_position(entity_id)
            if (pos != null) {
                Engine.log("NPC %(entity_id) says hello from (%(pos[0]), %(pos[1]))!")
            }
            Engine.set_flag(flag_name, true)
        }
    }
}
