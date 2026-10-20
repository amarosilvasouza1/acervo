package org.json;
import com.grack.nanojson.JsonParser;
import com.grack.nanojson.JsonWriter;
import java.util.*;
/** Test-only Android JSON facade backed by the existing NanoJSON parser. */
public class JSONObject {
    public static final Object NULL = new Object();
    final Map<String,Object> values;
    public JSONObject() { values = new LinkedHashMap<>(); }
    public JSONObject(String text) throws Exception { this(JsonParser.object().from(text)); }
    JSONObject(Map<?,?> data) { this(); for (Map.Entry<?,?> value : data.entrySet()) values.put(String.valueOf(value.getKey()), wrap(value.getValue())); }
    public JSONObject put(String key,Object value) { values.put(key, wrap(value)); return this; }
    public Object get(String key) { if (!values.containsKey(key)) throw new IllegalArgumentException(key); return values.get(key); }
    public Object remove(String key) { return values.remove(key); }
    public boolean has(String key) { return values.containsKey(key); }
    public String getString(String key) { return String.valueOf(get(key)); }
    public JSONArray getJSONArray(String key) { return (JSONArray)get(key); }
    public String optString(String key) { return optString(key, ""); }
    public String optString(String key,String fallback) { Object value=values.get(key); return value == null || value == NULL ? fallback : String.valueOf(value); }
    public long optLong(String key) { return optLong(key,0); }
    public long optLong(String key,long fallback) { try { Object value=values.get(key); return value instanceof Number ? ((Number)value).longValue() : Long.parseLong(String.valueOf(value)); } catch(Exception ignored) { return fallback; } }
    public int optInt(String key,int fallback) { return (int)optLong(key,fallback); }
    public JSONObject optJSONObject(String key) { Object value=values.get(key); return value instanceof JSONObject ? (JSONObject)value : null; }
    public JSONArray optJSONArray(String key) { Object value=values.get(key); return value instanceof JSONArray ? (JSONArray)value : null; }
    public String toString() { return JsonWriter.string(unwrap(this)); }
    static Object wrap(Object value) { if (value instanceof Map) return new JSONObject((Map<?,?>)value); if (value instanceof List) return new JSONArray((List<?>)value); return value == null ? NULL : value; }
    static Object unwrap(Object value) {
        if (value == NULL) return null;
        if (value instanceof JSONObject) { Map<String,Object> result=new LinkedHashMap<>(); for(Map.Entry<String,Object> entry:((JSONObject)value).values.entrySet()) result.put(entry.getKey(),unwrap(entry.getValue())); return result; }
        if (value instanceof JSONArray) { List<Object> result=new ArrayList<>(); for(Object item:((JSONArray)value).values) result.add(unwrap(item)); return result; }
        return value;
    }
}
