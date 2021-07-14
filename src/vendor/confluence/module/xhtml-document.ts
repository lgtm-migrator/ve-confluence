import xpath, {SelectedValue} from 'xpath';

import {
	DOMParser,
	XMLSerializer,
} from 'xmldom';

type Hash = Record<string, string>;

// prefix to use for all generated view IDs
const SI_VIEW_PREFIX = 've4';

// unique namespaces prefix
const P_URN_NS = 'urn:confluence-prefix:';

// set of prefixes to support when parsing XHTML strings from Confluence
const AS_PREFIXES = new Set(['ac', 'ri']);

// dict of namespaces to support from prefixes
const H_NAMESPACES = [...AS_PREFIXES].reduce(
	(h_out, si_ns) => ({
		...h_out,
		[si_ns]: `${P_URN_NS}${si_ns}`,
	}),
	{}
);

// prepare XHTML namespace declaration string
const SX_NAMESPACES = [...AS_PREFIXES]
	.map(si_ns => `xmlns:${si_ns}="${P_URN_NS}${si_ns}"`)
	.join(' ');

// for excluding elements that are within active directives
const SX_PARAMETER_ID = `ac:parameter[@ac:name="id"][starts-with(text(),"${SI_VIEW_PREFIX}-")]`;
const SX_EXCLUDE_ACTIVE_DIRECTIVES = `[not(ancestor::ac:structured-macro[@ac:name="span"][child::${SX_PARAMETER_ID}])]`;

// css style for active directives
const SX_STYLE_DIRECTIVE = 'background-color:lemonchiffon;';

const select_ns = xpath.useNamespaces({...H_NAMESPACES});

const select = (sx_xpath: string, ...a_args: any[]) => select_ns(sx_xpath.replace(/&nbsp;/g, '&#160;'), ...a_args);

export class XHTMLDocument {
	_sx_doc: string;
	_y_doc: Document;

	constructor(sx_doc: string) {
		this._sx_doc = sx_doc;

		this._y_doc = new DOMParser().parseFromString(
			`<xml ${SX_NAMESPACES}>${sx_doc}</xml>`
		);
	}

	select<T extends SelectedValue = SelectedValue>(sx_xpath: string): T[] {
		return select(sx_xpath, this._y_doc) as T[];
	}

	select1<T extends SelectedValue = SelectedValue>(sx_xpath: string): T {
		return select(sx_xpath, this._y_doc, true)[0] as T;
	}

	replaceChild(new_child: Node, old_child: Node): Node {
		return this._y_doc.replaceChild(new_child, old_child);
	}

	appendChild(new_child: Node): Node {
		return this._y_doc.appendChild(new_child);
	}

	createCDATA(child: string): Node {
		return this._y_doc.createCDATASection(child);
	}

	parseXml(xml_string: string): Node[] {
		let result: Node[] = [];
		const dom_doc = new DOMParser().parseFromString(
			`<xml ${SX_NAMESPACES}>${xml_string}</xml>`
		);
		for(let i = 0; i < dom_doc.childNodes.length; i++) {
			let item = dom_doc.childNodes.item(i);
			result[i] = item.cloneNode(true);
		}
		return result;
	}

	toString(): string {
		const y_serializer = new XMLSerializer();

		return y_serializer
			.serializeToString(this._y_doc)
			.replace(/^\s*<xml[^>]*>\s*|\s<\/xml>\s*$/, '');
	}

	builder(): (s_tag: string, h_attrs?: Hash, a_children?: Array<string | Node>) => Node {
		const y_doc = this._y_doc;

		return function(
			s_tag: string,
			h_attrs: Record<string, string> = {},
			a_children: Array<string | Node> = []
		): Node {
			const ym_node = y_doc.createElement(s_tag);

			for(const si_attr in h_attrs) {
				ym_node.setAttribute(si_attr, h_attrs[si_attr]);
			}

			for(const z_child of a_children) {
				let ym_child = z_child as Node;

				if('string' === typeof z_child) {
					ym_child = y_doc.createTextNode(z_child);
				}

				if(ym_child) {  //  && null === ym_child.parentNode
					ym_node.appendChild(ym_child);
				}
			}

			return ym_node;
		};
	}
}

export default XHTMLDocument;
