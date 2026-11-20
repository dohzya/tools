# Refs ok

Single line. <!-- ref: source.md:3 -->

Range. <!-- ref: source.md:8-10 -->

L forms. <!-- ref: source.md:L8 --> <!-- ref: source.md:L8-L10 --> <!-- ref: source.md:L8-10 -->

Anchor. <!-- ref: source.md:6^stable-id -->

Debug mrfi. <!-- ref: source.md:6~{v0;r=6:1-6:30;p=h1[1]/p[2];a=stable-id;fh=xxh64:4wtLb5Wj;hh=smh64:c1ebd373dc2071df;ctx=pre:6SU102dK,suf:iOqUfkNp;doc=smh64:c1abd377dc24719f} -->

Hangul mrfi. <!-- ref: source.md:6~떪딙낀뉚밀가띋뽴렬떱뺖슖됅괁밈눘꿀릩쀘솳꺺럜껙빝겍곑잺냆끪쇚밬군롦놕봲꼳멦씘양밷눬붘꽁늃뢦셌떁빤땭궥뎸셖룖뾜걄군롦놅봲꼳멮씘양쀷눧놘쩤꼰 -->

Base62 mrfi. <!-- ref: source.md:6~822pacNAzgtwU8A4cndI7UONUKJQ8STMqJmEUM8MzlcOorxO2R44JzLgMHjPlAa3oAVVTyj7UsqJVXJDEUBc5uEPfYESUtfWuaUOACR4EJNg6woHbHSOZ3wyROKjiO9VurCSRdGdE0hHzmsuhiRH -->

Debug mrfi + anchor. <!-- ref: source.md:6~{v0;r=6:1-6:30;p=h1[1]/p[2];a=stable-id;fh=xxh64:4wtLb5Wj;hh=smh64:c1ebd373dc2071df;ctx=pre:6SU102dK,suf:iOqUfkNp;doc=smh64:c1abd377dc24719f}^stable-id -->

Conversation passage. <!-- ref: source.md:14~{v0;r=14:1-14:20;p=h1[1]/h2[1]/p[1];fh=xxh64:FuimTJCD;hh=smh64:7f2a4e879f377bfd;ctx=pre:lEylNaSY,suf:ml2sXCLe;doc=smh64:c1abd377dc24719f} -->

Timestamped. <!-- ref%2026-06-16T17:35:35+02:00: source.md:3 -->

Multiple. <!-- ref: source.md:3; source.md:8-10; sub/../source.md:6 -->

Sibling dir. <!-- ref: sub/inner.md:1 -->

In a conversation. {?? @me Why? @agent ref: source.md:6 ??}

<!--
@me Why SAS here?
@agent ref: source.md:6
@me ok
-->
