import type { PipelineBlock } from '../pipelineModel'
import { TINT, STATE_WORD } from '../statusDisplay'
import { Icon } from './Icon'

type PipelineColumnProps = {
  blocks: PipelineBlock[]
  onOpen: (localId: string) => void
}

export const PipelineColumn = ({ blocks, onOpen }: PipelineColumnProps) => (
  <div className='pipeline-col'>
    <div className='comp-head'>
      <span className='ch-label'>
        <Icon name='pipeline' size={14} />
        Pipeline
      </span>
    </div>

    <div className='pipeline-body'>
      {blocks.length === 0 ? (
        <p className='pipe-empty'>No agent is running yet. Launched agents appear here.</p>
      ) : (
        blocks.map((block) => (
          <div className='pl-block' key={block.parent.localId}>
            <div
              className={`mini ${TINT[block.parent.status]}`}
              onClick={() => onOpen(block.parent.localId)}
            >
              <div className='m-icon'>
                <Icon name={block.parent.iconName} size={15} />
              </div>
              <div className='m-text'>
                <span className='m-name'>
                  {block.parent.name}
                  {block.parent.label ? ` · ${block.parent.label}` : ''}
                </span>
              </div>
              <span className='m-state'>
                <span className={`dot ${block.parent.status}`} />
                {STATE_WORD[block.parent.status]}
              </span>
            </div>

            {block.groups.length > 0 && (
              <>
                <div className='connector-down'>↓</div>
                <div className='pl-cont'>
                  {block.groups.map((g) => {
                    const nested = g.instances.length >= 2 || g.queued > 0
                    if (!nested) {
                      const inst = g.instances[0]
                      return (
                        <div
                          key={g.agentId}
                          className={`pl-single ${TINT[inst.status]}`}
                          onClick={() => onOpen(inst.localId)}
                        >
                          <div className='m-icon'>
                            <Icon name={g.iconName} size={15} />
                          </div>
                          <div className='m-text'>
                            <span className='m-name'>
                              {g.name}
                              {inst.label ? ` · ${inst.label}` : ''}
                            </span>
                          </div>
                          <span className='m-state'>
                            <span className={`dot ${inst.status}`} />
                            {STATE_WORD[inst.status]}
                          </span>
                        </div>
                      )
                    }
                    return (
                      <div key={g.agentId} className='pl-group'>
                        <div className='pl-ahead'>
                          <div className='m-icon'>
                            <Icon name={g.iconName} size={14} />
                          </div>
                          <span className='pl-aname'>{g.name}</span>
                          <span className='pl-acount'>{g.instances.length} active</span>
                        </div>
                        <div className='pl-kids'>
                          {g.instances.map((inst) => (
                            <div key={inst.localId} className='pl-kid'>
                              <span className='pl-hstub' />
                              <div
                                className={`pl-inst ${TINT[inst.status]}`}
                                onClick={() => onOpen(inst.localId)}
                              >
                                <span className='pl-iname'>{inst.label || inst.name}</span>
                                <span className='m-state'>
                                  <span className={`dot ${inst.status}`} />
                                  {STATE_WORD[inst.status]}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                        {g.queued > 0 && <p className='pl-queued'>queued: {g.queued}</p>}
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        ))
      )}
    </div>

    <div className='tint-legend'>
      <span className='ti'>
        <span className='sw run' />
        Running
      </span>
      <span className='ti'>
        <span className='sw await' />
        Awaiting approval
      </span>
      <span className='ti'>
        <span className='sw err' />
        Needs attention
      </span>
      <span className='ti'>
        <span className='sw idle' />
        Idle
      </span>
    </div>
  </div>
)
