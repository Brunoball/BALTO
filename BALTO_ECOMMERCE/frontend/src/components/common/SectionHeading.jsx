import React from 'react';
import { ArrowUpRight } from 'lucide-react';
import { Link } from 'react-router-dom';
export default function SectionHeading({ eyebrow, title, description, action, to }) {
  return <div className="section-heading"><div><div className="eyebrow">{eyebrow}</div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action && to && <Link className="section-link" to={to}>{action}<ArrowUpRight size={17}/></Link>}</div>;
}
