"""Tests for FieldNode schema and LayerNode.fields default."""

from app.schemas.capture import FieldNode, LayerNode


class TestFieldNodeSchema:
    def test_field_node_round_trip(self):
        fn = FieldNode(name="src", value="10.0.0.1", offset=12, length=4)
        d = fn.model_dump()
        assert d["name"] == "src"
        assert d["value"] == "10.0.0.1"
        assert d["offset"] == 12
        assert d["length"] == 4

    def test_field_node_null_offsets(self):
        fn = FieldNode(name="flags", value="DF", offset=None, length=None)
        d = fn.model_dump()
        assert d["offset"] is None
        assert d["length"] is None


class TestLayerNodeFieldsDefault:
    def test_fields_defaults_to_empty(self):
        ln = LayerNode(name="IP", summary="Internet Protocol", offset=14, length=20)
        assert ln.fields == []

    def test_layer_node_with_fields(self):
        fn = FieldNode(name="ttl", value="64", offset=22, length=1)
        ln = LayerNode(
            name="IP",
            summary="Internet Protocol",
            offset=14,
            length=20,
            fields=[fn],
        )
        assert len(ln.fields) == 1
        assert ln.fields[0].name == "ttl"
        d = ln.model_dump()
        assert d["fields"][0]["value"] == "64"
