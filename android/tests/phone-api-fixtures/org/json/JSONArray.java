package org.json;
import com.grack.nanojson.JsonParser;
import com.grack.nanojson.JsonWriter;
import java.util.*;
public class JSONArray {
    final List<Object> values = new ArrayList<>();
    public JSONArray() { }
    public JSONArray(String text) throws Exception { this(JsonParser.array().from(text)); }
    JSONArray(List<?> data) { for(Object value:data) values.add(JSONObject.wrap(value)); }
    public JSONArray put(Object value) { values.add(JSONObject.wrap(value)); return this; }
    public int length() { return values.size(); }
    public JSONObject getJSONObject(int index) { return (JSONObject)values.get(index); }
    public JSONObject optJSONObject(int index) { return index >= 0 && index < values.size() && values.get(index) instanceof JSONObject ? (JSONObject)values.get(index) : null; }
    public String optString(int index) { return index >= 0 && index < values.size() ? String.valueOf(values.get(index)) : ""; }
    public Object remove(int index) { return values.remove(index); }
    public String toString() { return JsonWriter.string(JSONObject.unwrap(this)); }
}
