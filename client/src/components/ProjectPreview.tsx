import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { Project } from '../types';
import { iframeScript } from '../assets/assets';
import EditorPanel from './EditorPanel';
import LoaderSteps from './LoaderSteps';

interface ProjectPreviewProps{
    project: Project;
    isGenerating: boolean;
    device?: 'phone' | 'tablet' | 'desktop';
    showEditorPanel?: boolean;
}

export interface ProjectPreviewRef {
    getCode: ()=> string | undefined;
}

const ProjectPreview = forwardRef<ProjectPreviewRef, ProjectPreviewProps>
(({project, isGenerating, device = 'desktop', showEditorPanel = true}, ref) => {

    const iframeRef = useRef<HTMLFrameElement>(null)
    const [selectedElement, setSelectedElement] = useState<any>(null)

    const resolutions = {
        phone: 'w-[412px]',
        tablet: 'w-[768px]',
        desktop: 'w-full'
    }

    useImperativeHandle(ref, ()=>({
        getCode: ()=> {
            const doc = iframeRef.current?.contentDocument;
            if(!doc) return undefined;
//1.remove selection class
            doc.querySelectorAll('.ai-selected-element, [data-ai-selected]').forEach((el)=>{
                const asEl = el as HTMLElement;
                if (!asEl) return;
                asEl.classList.remove('ai-selected-element');
                asEl.removeAttribute('data-ai-selected');
                if (asEl.style) asEl.style.outline = '';
            })

            //2.remove injected style 
            const previewStyle = doc.getElementById('ai-preview-style');
            if(previewStyle) previewStyle.remove();

            const previewScript = doc.getElementById('ai-preview-script');
            if(previewScript) previewScript.remove()

            const html = doc.documentElement.outerHTML;
            return html;
        }
    }))

    useEffect(()=>{
        const handleMessage = (event: MessageEvent)=>{
            if(event.data.type === 'ELEMENT_SELECTED'){
                setSelectedElement(event.data.payload);
            }else if(event.data.type === 'CLEAR_SELECTION'){
                setSelectedElement(null);
            }
        }
        window.addEventListener('message', handleMessage);
        return ()=> window.removeEventListener('message', handleMessage)
    },[])

    const handleUpdate = (updates: any)=>{
        if(iframeRef.current?.contentWindow){
            iframeRef.current.contentWindow.postMessage({
                type: 'UPDATE_ELEMENT',
                payload: updates
            }, '*')
        }
    }

    const injectPreview = (html: string)=> {
        if(!html) return '';
        if(!showEditorPanel) return html
        // remove known external scripts that may trigger Tracking Prevention
        const sanitizeHtml = (raw: string) => {
            // strip the Tailwind browser CDN which can access storage in some browsers
            return raw.replace(/<script[^>]*src=["']https:\/\/cdn\.jsdelivr\.net\/npm\/@tailwindcss\/browser@4[^"']*["'][^>]*>\s*<\/script>/gi, '')
        }

        const cleaned = sanitizeHtml(html);
        if(cleaned.includes('</body>')){
            return cleaned.replace('</body>', iframeScript + '</body>')
        }else{
            return cleaned + iframeScript;
        }
    }

  return (
    <div className='realtive h-full bg-gary-900 flex-1 rounded-xl overflow-hidden max-sm:ml-2'>
      {project.current_code ? (
        <>
        <iframe
        ref={iframeRef}
        srcDoc={injectPreview(project.current_code)}
        className={`h-full max-sm:w-full ${resolutions[device]} mx-auto transition-all`}/>
        {showEditorPanel && selectedElement && (
            <EditorPanel selectedElement={selectedElement}
            onUpdate={handleUpdate} onClose={()=>{
                setSelectedElement(null);
                if(iframeRef.current?.contentWindow){
                    iframeRef.current.contentWindow.postMessage({type: 'CLEAR_SELECTION_REQUEST'}, '*')
                }
            }}/>
        )}
        </>
      ): isGenerating && (
        <LoaderSteps />
      )}
    </div>
  )
})

export default ProjectPreview
