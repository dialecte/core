#!/usr/bin/env python3
"""
generate_definition.py
-----------------------

Single-file generator that parses an XSD entrypoint (e.g., SCL.xsd or IEC61850-6-100.xsd) and
emits a TypeScript DEFINITION object capturing:

- Elements with namespace and tag
- Attributes: required/default, namespace, resolved simple type name and facets (enum/pattern/etc.)
- Children: min/max occurrences
- Model groups: choice/sequence/all as validation hints
- Identity constraints: xs:key/xs:unique/xs:keyref with selectors/fields
- Wildcards
- Annotations (documentation)
- Reverse parents (computed)

Requirements:
  pip install xmlschema

Usage:
  python generate_definition.py --entry ../python/xsd/SCL.xsd --out-ts ../v2019C1/standard/generated.definition.ts

Notes:
- The script does not validate the schema semantics; it serializes structure and constraints.
- Enforcement is intended to happen in your TypeScript runtime using this catalog.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple
from collections import deque

try:
    import xmlschema
except Exception as e:  # pragma: no cover
    print("This script requires the 'xmlschema' package. Install with: pip install xmlschema", file=sys.stderr)
    raise


def ns_parts(qname: Optional[str]) -> Tuple[str, str]:
    """Split a QName '{uri}local' into (uri, local). Handles None and already-local names."""
    if not qname:
        return '', ''
    if qname.startswith('{') and '}' in qname:
        uri, local = qname[1:].split('}', 1)
        return uri, local
    return '', qname


def local_name(qname: Optional[str]) -> str:
    """Return the local part of a QName like '{ns}local' or the string itself if no ns, or '' for None."""
    if not qname:
        return ''
    if qname.startswith('{') and '}' in qname:
        return qname.split('}', 1)[1]
    return qname


def choose_prefix(uri: str, schema: xmlschema.XMLSchemaBase) -> str:
    # Default SCL namespace: always 'scl'
    if uri == 'http://www.iec.ch/61850/2003/SCL':
        return 'scl'
    # Use the prefix defined in the XSD when available
    for pfx, ns in schema.namespaces.items():
        if ns == uri:
            return pfx or ''
    return ''


def get_attr_facets(xsd_type: Any) -> Dict[str, Any]:
    """Collect facets (incl. enumeration & pattern) walking up the base type chain.

    The previous implementation only inspected the immediate type; some attribute types
    (e.g. lnClass -> tLNClassEnum) are restrictions whose enumeration resides on a base type.
    """
    if not xsd_type:
        return {}

    merged: Dict[str, Any] = {}
    enum_accum: List[Any] = []
    pattern_accum: List[str] = []
    visited: set[int] = set()
    to_visit: List[Any] = [xsd_type]
    while to_visit:
        current = to_visit.pop(0)
        if current is None or id(current) in visited:
            continue
        visited.add(id(current))
        xfacets = getattr(current, 'facets', None) or {}
        # Scalar facets
        for name, facet in list(xfacets.items()):
            local = local_name(str(name))
            if local in ('enumeration', 'pattern'):  # handled separately
                continue
            if local not in merged:
                val = None
                for attr in ('value', 'v', 'min_value', 'max_value'):
                    if hasattr(facet, attr):
                        val = getattr(facet, attr)
                        break
                if val is None and hasattr(facet, 'values'):
                    try:
                        val = list(getattr(facet, 'values'))
                    except Exception:
                        pass
                if val is not None:
                    merged[local] = val

        # Enumeration
        enum_vals = []
        enum_attr = getattr(current, 'enumeration', None)
        if enum_attr:
            try:
                enum_vals = list(enum_attr)
            except Exception:
                enum_vals = []
        else:
            enum_facet = xfacets.get('enumeration') if isinstance(xfacets, dict) else None
            if enum_facet is not None:
                if hasattr(enum_facet, 'values'):
                    try:
                        enum_vals = list(enum_facet.values)
                    except Exception:
                        pass
                elif hasattr(enum_facet, 'enumeration'):
                    try:
                        enum_vals = [getattr(i, 'value', None) for i in enum_facet.enumeration if getattr(i, 'value', None) is not None]
                    except Exception:
                        pass
        if enum_vals:
            for v in enum_vals:
                if v is not None and v not in enum_accum:
                    enum_accum.append(v)

        # Patterns
        pat_attr = getattr(current, 'patterns', None)
        if pat_attr:
            for p in pat_attr:
                for candidate in ('regex', 'pattern', 'value', 'source'):
                    v = getattr(p, candidate, None)
                    if v is not None:
                        try:
                            val = getattr(v, 'pattern', v)
                        except Exception:
                            val = str(v)
                        if val not in pattern_accum:
                            pattern_accum.append(val)
                        break
                else:
                    try:
                        text = getattr(p, 'text', None)
                        get = getattr(p, 'get', None)
                        if get and callable(get):
                            val = p.get('value')
                            if val and val not in pattern_accum:
                                pattern_accum.append(val)
                        elif text and text not in pattern_accum:
                            pattern_accum.append(text)
                    except Exception:
                        pass
        else:
            pat_facet = xfacets.get('pattern') if isinstance(xfacets, dict) else None
            if pat_facet is not None:
                for attr in ('patterns', 'value'):
                    if hasattr(pat_facet, attr):
                        try:
                            vals = getattr(pat_facet, attr)
                            if isinstance(vals, (list, tuple)):
                                for p in vals:
                                    s = getattr(p, 'pattern', None) or getattr(p, 'value', None) or getattr(p, 'text', None)
                                    if s and s not in pattern_accum:
                                        pattern_accum.append(s if isinstance(s, str) else str(s))
                            else:
                                if vals and vals not in pattern_accum:
                                    pattern_accum.append(str(vals))
                        except Exception:
                            pass

        # Walk base type chain
        # Walk base type chain
        try:
            base_t = getattr(current, 'base_type', None)
            if base_t is not None and id(base_t) not in visited:
                to_visit.append(base_t)
        except Exception:
            pass
        # Union member types
        try:
            member_types = getattr(current, 'member_types', None)
            if member_types:
                for mt in member_types:
                    if id(mt) not in visited:
                        to_visit.append(mt)
        except Exception:
            pass
        # Restriction's simple_type attribute (xmlschema sometimes nests it)
        try:
            simple_type = getattr(current, 'simple_type', None)
            if simple_type is not None and id(simple_type) not in visited:
                to_visit.append(simple_type)
        except Exception:
            pass

    if enum_accum:
        merged['enumeration'] = enum_accum
    if pattern_accum:
        merged['patterns'] = pattern_accum
    # Fallback: if still no enumeration, inspect raw XML subtree for <xs:enumeration value="..."/>
    if 'enumeration' not in merged:
        try:
            xml_elem = getattr(xsd_type, 'elem', None)
            if xml_elem is not None and hasattr(xml_elem, 'iter'):
                raw_values: List[str] = []
                for xml_child in xml_elem.iter():
                    tag = getattr(xml_child, 'tag', '') or ''
                    if not isinstance(tag, str):
                        continue
                    if tag.endswith('enumeration'):
                        val = xml_child.get('value') if hasattr(xml_child, 'get') else None
                        if val and val not in raw_values:
                            raw_values.append(val)
                if raw_values:
                    merged['enumeration'] = raw_values
        except Exception:
            pass
    return merged


def model_group_ir(group_or_content: Optional[Any]) -> Dict[str, Any]:
    ir: Dict[str, Any] = {}
    if group_or_content is None:
        return ir

    # If given a content object, try to get its model_group
    group = getattr(group_or_content, 'model_group', None)
    if group is None and hasattr(group_or_content, 'model'):
        group = group_or_content
    if group is None:
        return ir

    def walk(g: Any) -> Dict[str, Any]:
        if g.model == 'choice':
            sets: List[List[str]] = []
            for c in g:
                if hasattr(c, 'name') and c.name:
                    _, local = ns_parts(c.name)
                    sets.append([local])
                elif hasattr(c, 'model'):
                    sub = walk(c)
                    # flatten nested choices as alternatives
                    if 'group' in sub:          # changed from 'oneOf'
                        sets.extend(sub['group'])
            return {'group': sets}              # changed from {'oneOf': sets}
        elif g.model == 'sequence':
            seq: List[List[str]] = []
            for c in g:
                if hasattr(c, 'name') and c.name:
                    _, local = ns_parts(c.name)
                    seq.append([local])
                elif hasattr(c, 'model'):
                    sub = walk(c)
                    if 'sequence' in sub:
                        seq.extend(sub['sequence'])
            return {'sequence': seq}
        elif g.model == 'all':
            # Skip emitting 'all' to avoid verbosity; children are already captured with min/max in subElements
            return {}
        return {}

    return walk(group)


def identities_ir(x: Any) -> Dict[str, Any]:
    """
    Return normalized identity constraints for an element/component.

    Strategy:
      1. Collect from various runtime attributes exposed by xmlschema (identity_constraints,
         keys, uniques, keyrefs) handling list/dict forms.
      2. Normalize each constraint (key / unique / keyref).
      3. Fallback: parse raw XSD XML (x.elem) to extract <xs:key>, <xs:unique>, <xs:keyref>.
      4. De-duplicate across sources.
    """
    out: Dict[str, List[Dict[str, Any]]] = {'keys': [], 'uniques': [], 'keyrefs': []}
    seen: set[tuple] = set()

    def add(kind: str, name: str, selector: str, fields: List[str], refer: Optional[str] = None):
        signature = (kind, name, selector, tuple(fields), refer)
        if signature in seen:
            return
        seen.add(signature)
        if kind == 'key':
            out['keys'].append({'name': name, 'selector': selector, 'fields': fields})
        elif kind == 'unique':
            out['uniques'].append({'name': name, 'selector': selector, 'fields': fields})
        elif kind == 'keyref':
            out['keyrefs'].append({'name': name, 'refer': refer or '', 'selector': selector, 'fields': fields})

    # ---- 1 & 2. Runtime / compiled objects ----
    candidate_collections = []
    for attr_name in ('identity_constraints', 'keys', 'uniques', 'keyrefs'):
        raw = getattr(x, attr_name, None)
        if raw:
            candidate_collections.append(raw)

    for raw in candidate_collections:
        if isinstance(raw, dict):
            iterable = raw.values()
        else:
            iterable = raw
        for ic in iterable:
            try:
                category = getattr(ic, 'category', None)
                # Sometimes classname encodes it
                if not category:
                    cls_name = ic.__class__.__name__.lower()
                    if 'keyref' in cls_name:
                        category = 'keyref'
                    elif 'unique' in cls_name:
                        category = 'unique'
                    elif 'key' in cls_name:
                        category = 'key'
                if category not in ('key', 'unique', 'keyref'):
                    continue
                name = getattr(ic, 'name', '') or ''
                selector = str(getattr(ic, 'selector', '') or '')
                fields_raw = getattr(ic, 'fields', []) or []
                fields_list = [str(f) for f in fields_raw]
                refer = None
                if category == 'keyref':
                    refer_obj = getattr(ic, 'refer', None)
                    refer = getattr(refer_obj, 'name', '') if refer_obj is not None else ''
                if selector and fields_list:
                    add(category, name, selector, fields_list, refer)
            except Exception:
                continue  # Be resilient

    # ---- 3. Fallback: parse raw XML ----
    if getattr(x, 'elem', None) is not None:
        xml_elem = getattr(x, 'elem')
        try:
            for child in list(getattr(xml_elem, 'iter', lambda: [])()):
                tag = getattr(child, 'tag', '') or ''
                uri, loc = ns_parts(tag)
                if not loc or uri != XML_SCHEMA_NS:
                    continue
                if loc not in ('key', 'unique', 'keyref'):
                    continue
                name = (child.get('name') or '').strip()
                refer = (child.get('refer') or '').strip() if loc == 'keyref' else None

                selector_xpath = ''
                fields_xpaths: List[str] = []
                for sub in list(child):
                    sub_tag = getattr(sub, 'tag', '') or ''
                    _, sub_loc = ns_parts(sub_tag)
                    if sub_loc == 'selector':
                        selector_xpath = (sub.get('xpath') or '').strip()
                    elif sub_loc == 'field':
                        xp = (sub.get('xpath') or '').strip()
                        if xp:
                            fields_xpaths.append(xp)
                if selector_xpath and fields_xpaths:
                    add(loc, name, selector_xpath, fields_xpaths, refer)
        except Exception:
            pass  # Ignore XML fallback errors

    return out


def compute_quantifier(min_o: Optional[int], max_o: Optional[int]) -> Dict[str, Any]:
    """Return quantifier classification. 'custom' includes explicit min/max when not a common pattern."""
    mi = 0 if min_o is None else min_o
    ma = max_o
    if mi == 1 and (ma == 1):
        return {'quantifier': 'exactlyOnce'}
    if mi == 0 and (ma == 1):
        return {'quantifier': 'zeroOrOne'}
    if mi == 0 and (ma is None):
        return {'quantifier': 'zeroOrMore'}
    if mi == 1 and (ma is None):
        return {'quantifier': 'oneOrMore'}
    return {'quantifier': 'custom', 'min': mi, 'max': ma}


def build_sequence_order_ir(group_or_content: Optional[Any]) -> List[Dict[str, Any]]:
    """
    Build ordered list of content tokens (elements or choice groups).
    Elements appear in first-encounter order. A choice group inserts a single
    choice object preserving left-to-right position.
    """
    flat: List[Dict[str, Any]] = []
    if group_or_content is None:
        return flat
    group = getattr(group_or_content, 'model_group', None)
    if group is None and hasattr(group_or_content, 'model'):
        group = group_or_content
    if group is None:
        return flat

    def walk(g: Any):
        if g.model == 'choice':
            members: List[str] = []
            for c in g:
                if hasattr(c, 'name') and c.name:
                    _, loc = ns_parts(c.name)
                    if loc:
                        members.append(loc)
                elif hasattr(c, 'model'):
                    # Nested choice: inline its members (flatten one level)
                    if getattr(c, 'model', None) == 'choice':
                        # recurse to collect its members
                        nested: List[str] = []
                        for nc in c:
                            if hasattr(nc, 'name') and nc.name:
                                _, nloc = ns_parts(nc.name)
                                if nloc:
                                    nested.append(nloc)
                        members.extend(nested)
                    else:
                        # Nested sequence inside choice (rare). Collect first-level element names in order as a composite alternative? For simplicity flatten.
                        for sc in c:
                            if hasattr(sc, 'name') and sc.name:
                                _, sloc = ns_parts(sc.name)
                                if sloc:
                                    members.append(sloc)
            q = compute_quantifier(getattr(g, 'min_occurs', 1), getattr(g, 'max_occurs', 1))
            flat.append({
                'kind': 'choice',
                **q,
                'group': members        # changed from 'oneOf'
            })
        elif g.model in ('sequence', 'all'):
            for c in g:
                if hasattr(c, 'name') and c.name:
                    _, loc = ns_parts(c.name)
                    if loc:
                        flat.append({'kind': 'element', 'name': loc})
                elif hasattr(c, 'model'):
                    walk(c)

    walk(group)
    return flat


def element_ir(schema: xmlschema.XMLSchemaBase, elem: Any) -> Dict[str, Any]:
    uri, local = ns_parts(elem.name)
    prefix = choose_prefix(uri, schema)

    # --- Attributes (add enum field, strip enumeration from validation) ---
    attribute_details: Dict[str, Any] = {}
    attribute_names_available: List[str] = []

    def has_any_attribute_wildcard(type_node: Any) -> bool:
        seen_type_ids: set[int] = set()
        current_type = type_node
        while current_type is not None and id(current_type) not in seen_type_ids:
            seen_type_ids.add(id(current_type))
            type_attributes = getattr(current_type, 'attributes', None)
            if type_attributes is not None and getattr(type_attributes, 'wildcard', None) is not None:
                return True
            try:
                if hasattr(current_type, 'iter_components'):
                    for component in current_type.iter_components():
                        component_name = type(component).__name__.lower()
                        if 'anyattribute' in component_name:
                            return True
                        if getattr(component, 'wildcard', None) is not None and 'attribute' in component_name:
                            return True
                underlying_type_xml_elem = getattr(current_type, 'elem', None)
                if underlying_type_xml_elem is not None and hasattr(underlying_type_xml_elem, 'iter'):
                    for xml_node in underlying_type_xml_elem.iter():
                        tag_name = getattr(xml_node, 'tag', '') or ''
                        if isinstance(tag_name, str) and (tag_name.endswith('anyAttribute') or tag_name.lower().endswith('anyattribute')):
                            return True
            except Exception:
                pass
            current_type = getattr(current_type, 'base_type', None)
        return False

    element_type_obj = getattr(elem, 'type', None)
    type_content = getattr(element_type_obj, 'content', None)
    attributes_any_wildcard = False
    if has_any_attribute_wildcard(element_type_obj):
        attributes_any_wildcard = True
    try:
        element_level_attributes = getattr(elem, 'attributes', None)
        if element_level_attributes is not None and getattr(element_level_attributes, 'wildcard', None) is not None:
            attributes_any_wildcard = True
    except Exception:
        pass
    try:
        content_level_attributes = getattr(type_content, 'attributes', None)
        if content_level_attributes is not None and getattr(content_level_attributes, 'wildcard', None) is not None:
            attributes_any_wildcard = True
    except Exception:
        pass
    try:
        underlying_type_xml_tree = getattr(element_type_obj, 'elem', None)
        underlying_element_xml_tree = getattr(elem, 'elem', None)
        for xml_tree_node in filter(None, [underlying_type_xml_tree, underlying_element_xml_tree]):
            if hasattr(xml_tree_node, 'iter'):
                for xml_node in xml_tree_node.iter():
                    tag_name = getattr(xml_node, 'tag', '') or ''
                    if isinstance(tag_name, str) and (tag_name.endswith('anyAttribute') or tag_name.lower().endswith('anyattribute')):
                        attributes_any_wildcard = True
                        raise StopIteration
    except StopIteration:
        pass

    for attribute_key, attribute in elem.attributes.items():
        attribute_qname = attribute.name or attribute_key
        attr_uri, attr_local = ns_parts(attribute_qname)
        if not attr_local:
            continue
        # If attribute has no URI, set namespace to None
        attr_namespace = None
        if attr_uri:
            attr_namespace = {
                'uri': attr_uri,
                'prefix': choose_prefix(attr_uri, schema)
            }
        attribute_names_available.append(attr_local)
        attribute_type_name: Optional[str] = None
        if getattr(attribute, 'type', None) is not None:
            attribute_type_name = local_name(getattr(attribute.type, 'name', None))
            if attribute_type_name is None and getattr(attribute.type, 'base_type', None) is not None:
                attribute_type_name = local_name(getattr(attribute.type.base_type, 'name', None))
        attribute_facets = get_attr_facets(getattr(attribute, 'type', None))
        enum_values = None
        if attribute_facets:
            enum_values = attribute_facets.pop('enumeration', None)  # remove enumeration from validation
            if not attribute_facets:
                attribute_facets = None
        attribute_details[attr_local] = {
            'namespace': attr_namespace,
            'required': attribute.use == 'required',
            'default': attribute.fixed if attribute.fixed is not None else (attribute.default if attribute.default is not None else None),
            'type': attribute_type_name,
            'enum': enum_values or None,
            'validation': attribute_facets
        }

    # --- Sub-elements (mirror attribute detail but WITHOUT enum; min/max moved into validation) ---
    subelement_details: Dict[str, Any] = {}
    subelement_names_available: List[str] = []
    any_child_wildcard = False
    content_model = getattr(elem.type, 'content', None)
    if content_model is not None and hasattr(content_model, 'iter_elements'):
        for child_component in content_model.iter_elements():
            if not getattr(child_component, 'name', None):
                continue
            _, child_local = ns_parts(child_component.name)
            if not child_local:
                continue
            subelement_names_available.append(child_local)

            # Identity constraints for the child
            child_identity_validation = identities_ir(child_component)

            # Derive child type + facets (extract enumeration but we DROP it for subElements)
            child_type = getattr(child_component, 'type', None)
            child_type_name: Optional[str] = None
            if child_type is not None:
                child_type_name = local_name(getattr(child_type, 'name', None))
                if not child_type_name and getattr(child_type, 'base_type', None) is not None:
                    child_type_name = local_name(getattr(child_type.base_type, 'name', None))

            child_facets = get_attr_facets(child_type)
            if child_facets:
                # discard enumeration for subElements
                child_facets.pop('enumeration', None)
                if not child_facets:
                    child_facets = None

            # Always have a validation object (hold min/max + optional facets / identityConstraints)
            child_validation_obj: Dict[str, Any] = {
                'minOccurrence': int(child_component.min_occurs or 0),
                'maxOccurrence': (None if child_component.max_occurs is None else int(child_component.max_occurs)),
            }
            if (child_identity_validation.get('keys') or
                child_identity_validation.get('uniques') or
                child_identity_validation.get('keyrefs')):
                child_validation_obj['identityConstraints'] = child_identity_validation
            if child_facets:
                child_validation_obj['facets'] = child_facets

            subelement_details[child_local] = {
                'required': (child_component.min_occurs or 0) >= 1,
                'type': child_type_name,
                'validation': child_validation_obj
            }

        def has_any_in_content(type_node: Any) -> bool:
            seen_types: set[int] = set()
            current_type = type_node
            while current_type is not None and id(current_type) not in seen_types:
                seen_types.add(id(current_type))
                current_content = getattr(current_type, 'content', None)
                if current_content is not None:
                    try:
                        if getattr(current_content, 'wildcards', None):
                            return True
                        if hasattr(current_content, 'iter_components'):
                            for component in current_content.iter_components():
                                component_name = type(component).__name__.lower()
                                if 'any' in component_name or getattr(component, 'wildcard', None) is not None:
                                    return True
                    except Exception:
                        pass
                current_type = getattr(current_type, 'base_type', None)
            return False

        any_child_wildcard = has_any_in_content(getattr(elem, 'type', None))

    # REMOVE old model_groups object usage; we only keep the flattened sequence_order
    # model_groups = model_group_ir(content_model) if content_model is not None else {}
    sequence_order = build_sequence_order_ir(content_model) if content_model is not None else []
    identity_constraints = identities_ir(elem)

    documentation_texts: List[str] = []
    annotations = getattr(elem, 'annotations', None) or []
    for annotation in annotations:
        for documentation in getattr(annotation, 'documentation', []) or []:
            doc_text = getattr(documentation, 'text', None)
            if doc_text:
                documentation_texts.append(doc_text.strip())

    # Determine simple content and capture its facets (similar to attributes) for later canonical mapping
    element_type_obj_for_value = getattr(elem, 'type', None)
    has_simple_content = bool(getattr(element_type_obj_for_value, 'has_simple_content', False)) or bool(getattr(element_type_obj_for_value, 'mixed', False))
    simple_content_facets = None
    simple_content_type_name = None
    if has_simple_content:
        try:
            base_t = getattr(element_type_obj_for_value, 'content_type', None) or getattr(element_type_obj_for_value, 'simple_type', None) or getattr(element_type_obj_for_value, 'base_type', None)
            if base_t is not None:
                simple_content_type_name = local_name(getattr(base_t, 'name', None)) or None
            # collect facets from the element's own type if available
            simple_content_facets = get_attr_facets(element_type_obj_for_value)
            if not simple_content_facets:
                simple_content_facets = None
        except Exception:
            simple_content_facets = None

    text_content_allowed = has_simple_content

    element_node: Dict[str, Any] = {
        'tag': local,
        'namespace': {
            'uri': uri,
            'prefix': prefix
        },
        'attributes': {
            'any': bool(attributes_any_wildcard),
            'available': sorted(set(attribute_names_available)),
            'details': attribute_details
        },
        'subElements': {
            'any': bool(any_child_wildcard),
            'available': sorted(set(subelement_names_available)),
            'details': subelement_details
        },
        'validation': {
            'sequence': (sequence_order or None),  # renamed from 'modelGroups'
            'identityConstraints': identity_constraints,
            'textContent': bool(text_content_allowed),
            # auxiliary fields for canonical extraction of value model
            'simpleContentFacets': simple_content_facets,
            'simpleContentTypeName': simple_content_type_name,
        },
        'documentation': documentation_texts or None
    }
    return element_node


# Business-element filtering & collision control constants
XML_SCHEMA_NS = 'http://www.w3.org/2001/XMLSchema'
XSD_RESERVED_LOCAL_NAMES = {
    # Structural / schema-construction tags we never want as business elements
    'schema','annotation','documentation','appinfo',
    'simpleType','complexType','complexContent','simpleContent',
    'extension','restriction','sequence','choice','all','group',
    'attribute','attributeGroup','any','anyAttribute','list','union',
    'key','keyref','unique','selector','field'
}

def is_business_element(elem: Any) -> bool:
    """
    Return True if the compiled element represents an application/business
    element (named, not in XMLSchema namespace, not a structural helper).
    """
    name = getattr(elem, 'name', None)
    if not name:
        return False
    uri, local = ns_parts(name)
    if not local:
        return False
    if uri == XML_SCHEMA_NS:
        return False
    if local in XSD_RESERVED_LOCAL_NAMES:
        return False
    return True


def build_ir(schema: xmlschema.XMLSchemaBase) -> Dict[str, Any]:
    elements: Dict[str, Any] = {}
    parents: Dict[str, List[str]] = {}
    collisions: set[str] = set()

    try:
        globals_map = getattr(schema, 'maps', None)
        starting_elements = list(getattr(globals_map, 'elements', {}).values()) if globals_map is not None else list(schema.elements.values())
    except Exception:
        starting_elements = list(schema.elements.values())

    processing_queue: deque[Any] = deque(starting_elements)
    visited_qualified_names: set[str] = set()

    while processing_queue:
        current_xsd_element = processing_queue.popleft()
        if not getattr(current_xsd_element, 'name', None):
            continue
        qualified_name = current_xsd_element.name
        if qualified_name in visited_qualified_names:
            continue
        visited_qualified_names.add(qualified_name)

        uri, local = ns_parts(qualified_name)
        if not local:
            continue
        if not is_business_element(current_xsd_element):
            continue

        new_element_node = element_ir(schema, current_xsd_element)

        if local in elements:
            previous_namespace_uri = elements[local]['namespace']['uri']
            new_namespace_uri = new_element_node['namespace']['uri']
            if previous_namespace_uri != new_namespace_uri:
                collisions.add(local)
            elements[local] = new_element_node
        else:
            elements[local] = new_element_node

        try:
            content_model = getattr(current_xsd_element.type, 'content', None)
            if content_model is not None and hasattr(content_model, 'iter_elements'):
                for child_element in content_model.iter_elements():
                    if getattr(child_element, 'name', None):
                        processing_queue.append(child_element)
        except Exception:
            pass

    for parent_name, element_node in elements.items():
        for child_name in element_node.get('subElements', {}).get('available', []):
            parents.setdefault(child_name, []).append(parent_name)
    for element_name, element_node in elements.items():
        element_node['parents'] = sorted(set(parents.get(element_name, [])))

    namespace_list = sorted(set(e['namespace']['uri'] for e in elements.values() if e['namespace']['uri']))

    print(
        f"[generate_definition] SUMMARY: elements={len(elements)} collisions={len(collisions)}",
        file=sys.stderr
    )
    if collisions:
        print(
            "[generate_definition] COLLISION NAMES: " + ", ".join(sorted(collisions)),
            file=sys.stderr
        )

    return {
        'schema_version': 'ir-v1',
        'namespaces': namespace_list,
        'elements': elements,
    }


## Canonical-only generator: legacy DEFINITION export removed.


# ---------------- Canonical Model Generation ---------------- #

CanonicalElement = Dict[str, Any]

def _empty_validation_model() -> Dict[str, Any]:
    return {
        'enumeration': None,
        'pattern': None,
        'minInclusive': None,
        'maxInclusive': None,
        'minLength': None,
        'maxLength': None,
        'fractionDigits': None,
        'totalDigits': None,
        'whitespace': None,
        'assertions': None,
        'minOccurrence': None,
        'maxOccurrence': None,
    }

def _facets_to_validation(facets: Optional[Dict[str, Any]], *, min_o: Optional[int] = None, max_o: Optional[int] = None) -> Dict[str, Any]:
    v = _empty_validation_model()
    if facets:
        # Map known facet keys from current IR shapes
        enum_vals = facets.get('enumeration') or facets.get('enum')
        if enum_vals:
            v['enumeration'] = list(enum_vals)
        patterns = facets.get('patterns') or facets.get('pattern')
        if patterns:
            v['pattern'] = list(patterns) if isinstance(patterns, (list, tuple)) else [patterns]
        for k_src, k_dst in [
            ('minInclusive','minInclusive'), ('maxInclusive','maxInclusive'),
            ('minLength','minLength'), ('maxLength','maxLength'),
            ('fractionDigits','fractionDigits'), ('totalDigits','totalDigits'),
            ('whiteSpace','whitespace'), ('whitespace','whitespace')
        ]:
            if k_src in facets and facets[k_src] is not None:
                v[k_dst] = facets[k_src]
    # Occurrence
    if min_o is not None:
        v['minOccurrence'] = int(min_o)
    if max_o is not None:
        v['maxOccurrence'] = None if max_o is None else int(max_o)
    return v

def _unify_identity_constraints(raw: Dict[str, Any]) -> List[Dict[str, Any]]:
    unified: List[Dict[str, Any]] = []
    if not raw:
        return unified
    for kind_key, kind in [('keys','key'), ('uniques','unique'), ('keyrefs','keyref')]:
        for item in raw.get(kind_key, []) or []:
            selector = item.get('selector','')
            fields = item.get('fields', []) or []
            paths: List[List[str]] = []
            # Very simple xpath token split: remove leading ./, @; separate by '/'
            def _tokenize(xp: str) -> List[str]:
                if not xp:
                    return []
                xp = xp.strip()
                xp = xp.lstrip('./')
                parts = [p for p in xp.split('/') if p and p not in ('.',)]
                cleaned: List[str] = []
                for p in parts:
                    if p.startswith('@'):
                        cleaned.append(p)
                    else:
                        # drop namespace if present prefix:
                        cleaned.append(p.split(':',1)[-1])
                return cleaned
            selector_tokens = _tokenize(selector)
            # Each field path appended to selector tokens for now (simplified). Could store separately if needed.
            field_tokens_group: List[str] = []
            attr_names: List[str] = []
            for f in fields:
                toks = _tokenize(f)
                if toks and toks[0].startswith('@'):
                    # attribute field only
                    attr_names.append(toks[0][1:])
                elif toks:
                    field_tokens_group.extend(toks)
            path_entry: List[str] = selector_tokens + [t for t in field_tokens_group if not t.startswith('@')]
            if path_entry:
                paths.append(path_entry)
            unified.append({
                'name': item.get('name',''),
                'kind': kind,
                'paths': paths,
                'deep': '//' in selector,
                'attributes': attr_names,
                'refer': item.get('refer', None) or None,
                'text': False,
            })
    return unified

def build_canonical_from_ir(ir: Dict[str, Any]) -> Dict[str, CanonicalElement]:
    canonical: Dict[str, CanonicalElement] = {}
    elements = ir.get('elements', {})
    for name, elem in elements.items():
        # Documentation join
        documentation = None
        docs = elem.get('documentation')
        if isinstance(docs, list) and docs:
            documentation = '\n\n'.join(docs)
        elif isinstance(docs, str):
            documentation = docs

        # Attributes
        attr_block = elem.get('attributes', {})
        attr_details_current: Dict[str, Any] = attr_block.get('details', {})
        attr_sequence: List[str] = list(sorted(attr_details_current.keys()))  # alphabetical deterministic order
        canonical_attr_details: Dict[str, Any] = {}
        for aname in attr_sequence:
            ainfo = attr_details_current[aname]
            facets = ainfo.get('validation') or {}
            if ainfo.get('enum'):
                facets = dict(facets or {})
                facets['enumeration'] = ainfo['enum']
            ns_info = ainfo.get('namespace')
            # If namespace is None (attribute has no namespace), keep it as None
            ns_obj_attr = None
            if ns_info is not None:
                ns_uri_attr = ns_info.get('uri')
                existing_prefix = ns_info.get('prefix')
                derived_prefix = existing_prefix
                if not derived_prefix:
                    if ns_uri_attr == 'http://www.iec.ch/61850/2003/SCL':
                        derived_prefix = 'scl'
                    else:
                        derived_prefix = ''
                ns_obj_attr = {
                    'prefix': derived_prefix,
                    'uri': ns_uri_attr
                }
            canonical_attr_details[aname] = {
                'required': bool(ainfo.get('required')),
                'default': ainfo.get('default'),
                'namespace': ns_obj_attr,
                'validation': _facets_to_validation(facets)
            }

        # Sub-elements
        sub_block = elem.get('subElements', {})
        detail_current = sub_block.get('details', {})
        # Build ordered sequence list and choice groups from validation.sequence
        seq_items = elem.get('validation', {}).get('sequence') or []
        ordered_names: List[str] = []
        choices: List[Dict[str, Any]] = []
        for entry in seq_items:
            if entry.get('kind') == 'element':
                n = entry.get('name')
                if n and n not in ordered_names:
                    ordered_names.append(n)
            elif entry.get('kind') == 'choice':
                options = entry.get('group', [])
                for opt in options:
                    if opt not in ordered_names:
                        ordered_names.append(opt)
                min_o = entry.get('min') if entry.get('quantifier') == 'custom' else None
                max_o = entry.get('max') if entry.get('quantifier') == 'custom' else None
                # Map quantifier short-hands
                q = entry.get('quantifier')
                if q == 'exactlyOnce':
                    min_o, max_o = 1, 1
                elif q == 'zeroOrOne':
                    min_o, max_o = 0, 1
                elif q == 'zeroOrMore':
                    min_o, max_o = 0, None
                elif q == 'oneOrMore':
                    min_o, max_o = 1, None
                choices.append({
                    'minOccurrence': min_o,
                    'maxOccurrence': max_o,
                    'options': options
                })

        canonical_child_details: Dict[str, Any] = {}
        for cname, cinfo in detail_current.items():
            val = cinfo.get('validation', {})
            min_o = val.get('minOccurrence')
            max_o = val.get('maxOccurrence')
            facets = val.get('facets') or {}
            child_validation = _facets_to_validation(facets, min_o=min_o, max_o=max_o)
            # Child-level identity constraints (if present) -> constraints array
            idc = val.get('identityConstraints') or {}
            child_constraints = _unify_identity_constraints(idc) if idc else None
            canonical_child_details[cname] = {
                'required': bool(cinfo.get('required')),
                'validation': child_validation,
                'constraints': child_constraints if child_constraints else None
            }

        # Element-level identity constraints
        el_identity_raw = elem.get('validation', {}).get('identityConstraints') or {}
        el_constraints = _unify_identity_constraints(el_identity_raw)

        # Value (simple content) detection with facets
        value_model = None
        val_meta = elem.get('validation', {})
        if val_meta.get('textContent'):
            value_facets = val_meta.get('simpleContentFacets') or {}
            unified_val_validation = _facets_to_validation(value_facets)
            value_model = {
                'type': val_meta.get('simpleContentTypeName'),
                'validation': unified_val_validation
            }

        # Namespace already explicit (no collapsing of base URI)
        ns_obj = elem.get('namespace', {}) or {}

        canonical[name] = {
            'tag': elem.get('tag', name),
            'namespace': ns_obj,
            'documentation': documentation,
            'parents': elem.get('parents', []),
            'validation': _empty_validation_model(),  # element-level simple type facets not tracked (kept null)
            'attributes': {
                'any': bool(attr_block.get('any')),
                'sequence': attr_sequence,
                'details': canonical_attr_details
            },
            'subElements': {
                'any': bool(sub_block.get('any')),
                'sequence': ordered_names,
                'details': canonical_child_details,
                'choices': choices
            },
            'constraints': el_constraints,
            'value': value_model
        }
    return canonical

def emit_ts_canonical(canonical: Dict[str, CanonicalElement], out_path: Path) -> None:
    def _default(o: Any) -> Any:
        if isinstance(o, Decimal):
            return str(o)
        return str(o)
    js = json.dumps(canonical, ensure_ascii=False, indent=2, default=_default)
    lines = [
        '// Auto-generated canonical model. Do not edit manually.',
        '// eslint-disable',
        'export const CANONICAL = ' + js + ' as const;'  # aligns with TypeScript consumption
    ]
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text('\n'.join(lines))


def emit_json_canonical(canonical: Dict[str, CanonicalElement], out_path: Path) -> None:
    """Emit the canonical model as pure JSON (data-only) for runtime loading.

    This is an optional artifact to decouple runtime consumption from TypeScript compile
    costs and will be the basis for future shard/chunk generation.
    """
    def _default(o: Any) -> Any:
        if isinstance(o, Decimal):
            return str(o)
        return str(o)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(canonical, ensure_ascii=False, indent=2, default=_default))


def main(argv: Optional[List[str]] = None) -> int:
    p = argparse.ArgumentParser(description='Generate canonical SCL model artifacts from XSD')
    p.add_argument('--entry', required=True, help='Path to entry XSD (e.g., SCL.xsd or IEC61850-6-100.xsd)')
    p.add_argument('--out-ts', required=True, help='Output TypeScript file path for canonical model (single source of truth)')
    p.add_argument('--out-json', required=False, help='Optional output JSON file path for canonical model (data-only)')
    # No JSON IR emission and no namespace override to keep it simple and aligned with XSD
    args = p.parse_args(argv)

    entry = Path(args.entry).resolve()
    out_ts = Path(args.out_ts).resolve()
    schema = xmlschema.XMLSchema11(str(entry))
    ir = build_ir(schema)

    canonical = build_canonical_from_ir(ir)
    emit_ts_canonical(canonical, out_ts)
    if getattr(args, 'out_json', None):
        emit_json_canonical(canonical, Path(args.out_json).resolve())
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
    raise SystemExit(main())
    raise SystemExit(main())
